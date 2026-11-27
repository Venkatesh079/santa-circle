import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import recoveryQuestions from './recovery-questions.json' with { type: 'json' };
import { AppError, SESSION_SECONDS, type User, type UserRow, type Match } from './store-types.ts';
import { PgDatabase } from './postgres.ts';
const publicUser = (row: UserRow): User => ({ id: row.id, name: row.name, admin: Boolean(row.admin), wishlist: row.wishlist });
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const normalizeAnswer = (answer: string) => answer.trim().replace(/\s+/g, " ").toLowerCase();
function validateRecovery(question: string, answer: string) {
    if (!Object.hasOwn(recoveryQuestions, question))
        throw new AppError("Choose a recovery question.");
    const normalized = normalizeAnswer(answer);
    if (normalized.length < 2 || Buffer.byteLength(normalized) > 72)
        throw new AppError("Use a recovery answer with at least 2 characters and at most 72 UTF-8 bytes.");
    return normalized;
}
export class PostgresStore {
    readonly db: PgDatabase;
    constructor(db: PgDatabase) { this.db = db; }
    async initialize(adminName: string, adminPassword: string) {
        if (Buffer.byteLength(adminPassword) < 8 || Buffer.byteLength(adminPassword) > 72)
            throw new Error('ADMIN_PASSWORD must be between 8 and 72 UTF-8 bytes.');
        const name = adminName.trim().replace(/\s+/g, ' ');
        const nameKey = normalizeName(name);
        await this.transaction(async () => {
            if (!nameKey || name.length > 80 || (await this.approvedPeople()).some(person => normalizeName(person.name) === nameKey))
                throw new Error('ADMIN_NAME must be distinct from participants.');
            const existing = await this.db.prepare('SELECT * FROM users WHERE admin = 1').get() as UserRow | undefined;
            if (!existing) {
                await this.db.prepare('INSERT INTO users(id,name_key,name,password_hash,admin) VALUES(?,?,?,?,1)').run(randomUUID(), nameKey, name, await bcrypt.hash(adminPassword, 12));
            }
            else if (existing.name !== name || !await bcrypt.compare(adminPassword, existing.password_hash)) {
                await this.db.prepare('UPDATE users SET name_key = ?,name = ?,password_hash = ? WHERE id = ?').run(nameKey, name, await bcrypt.hash(adminPassword, 12), existing.id);
                await this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
            }
        });
    }
    private async transaction<T>(fn: () => Promise<T>): Promise<T> { return (await this.db.transaction(fn)); }
    async enabled() { return Boolean((await this.db.prepare("SELECT enabled FROM exchange WHERE id = 1").get())!.enabled); }
    async drawRevision() { return Number((await this.db.prepare("SELECT revision FROM exchange WHERE id = 1").get())!.revision); }
    async user(id: string) {
        const row = (await this.db.prepare("SELECT * FROM users WHERE id = ?").get(id)) as UserRow | undefined;
        return row ? publicUser(row) : undefined;
    }
    async participants() {
        return (await this.db.prepare("SELECT id,name,approved_person_id FROM users WHERE admin = 0 ORDER BY name").all()) as {
            id: string;
            name: string;
            approved_person_id: number | null;
        }[];
    }
    async approvedPeople() {
        return (await this.db.prepare("SELECT id,name FROM approved_people ORDER BY name").all()) as {
            id: number;
            name: string;
        }[];
    }
    async addPerson(adminId: string, input: string) {
        return (await this.transaction(async () => {
            if (!(await this.user(adminId))?.admin)
                throw new AppError("Only the administrator can manage participants.");
            if ((await this.enabled()))
                throw new AppError("Participants cannot be changed after the draw has started.");
            const name = input.trim().replace(/\s+/g, " ");
            if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))
                throw new AppError("Enter the full name from the Aria Profile, using up to 80 characters.");
            const key = normalizeName(name);
            if ((await (await this.approvedPeople()).some(person => normalizeName(person.name) === key)) || (await this.db.prepare("SELECT 1 FROM users WHERE name_key = ?").get(key)))
                throw new AppError("That name is already in use. Each person can be added only once.");
            (await this.db.prepare("INSERT INTO approved_people(name) VALUES(?)").run(name));
        }));
    }
    async removePerson(adminId: string, personId: number, expectedName: string) {
        return (await this.transaction(async () => {
            if (!(await this.user(adminId))?.admin)
                throw new AppError("Only the administrator can manage participants.");
            if ((await this.enabled()))
                throw new AppError("Participants cannot be changed after the draw has started.");
            const person = (await this.db.prepare("SELECT name FROM approved_people WHERE id = ?").get(personId));
            if (!person || person.name !== expectedName)
                throw new AppError("The approved list has changed. Refresh the dashboard before deleting anyone.");
            const user = (await this.db.prepare("SELECT id,admin FROM users WHERE approved_person_id = ?").get(personId));
            if (user?.admin)
                throw new AppError("The administrator account cannot be removed.");
            if (user) {
                (await this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id));
                (await this.db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(user.id));
                (await this.db.prepare("DELETE FROM users WHERE id = ?").run(user.id));
            }
            const key = normalizeName(String(person.name));
            (await this.db.prepare("DELETE FROM attempts WHERE key IN (?,?)").run("name:" + key, "recovery-reset:" + key));
            (await this.db.prepare("DELETE FROM approved_people WHERE id = ?").run(personId));
        }));
    }
    async needsRosterReview() {
        return Boolean((await this.db.prepare("SELECT 1 FROM users WHERE admin = 0 AND approved_person_id IS NULL LIMIT 1").get()));
    }
    async linkParticipant(adminId: string, userId: string, personId: number) {
        if (!(await this.user(adminId))?.admin)
            throw new AppError("Only the administrator can match existing accounts.");
        return (await this.transaction(async () => {
            const participant = (await this.db.prepare("SELECT id FROM users WHERE id = ? AND admin = 0 AND approved_person_id IS NULL").get(userId));
            const person = (await this.db.prepare("SELECT name FROM approved_people WHERE id = ?").get(personId));
            if (!participant || !person)
                throw new AppError("Select an unmatched account and an approved name.");
            if ((await this.db.prepare("SELECT id FROM users WHERE approved_person_id = ?").get(personId)))
                throw new AppError("That person already has an account.");
            (await this.db.prepare("UPDATE users SET name = ?, name_key = ?, approved_person_id = ? WHERE id = ?").run(person.name, normalizeName(String(person.name)), personId, userId));
        }));
    }
    // Persistent throttling survives restarts and is shared by app processes.
    async throttle(key: string, limit = 10) {
        const now = Date.now();
        (await this.db.prepare("DELETE FROM attempts WHERE reset <= ?").run(now));
        const attempt = (await this.db.prepare(`INSERT INTO attempts(key,count,reset) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET count = attempts.count + 1 RETURNING count`).get(key, now + 15 * 60000))!;
        if (Number(attempt.count) > limit)
            throw new AppError("Too many attempts. Try again in 15 minutes.");
    }
    async clearThrottle(key: string) { (await this.db.prepare("DELETE FROM attempts WHERE key = ?").run(key)); }
    async register(name: string, password: string, recoveryQuestion = "", recoveryAnswer = "") {
        if (!name.trim() || name.trim().length > 80)
            throw new AppError("Enter your full name as shown in your Aria Profile.");
        if (password.length < 8 || Buffer.byteLength(password) > 72)
            throw new AppError("Use at least 8 characters and at most 72 UTF-8 bytes for your password.");
        const hasRecovery = Boolean(recoveryQuestion.trim() || recoveryAnswer.trim());
        const answer = hasRecovery ? validateRecovery(recoveryQuestion, recoveryAnswer) : null;
        if ((await this.enabled()))
            throw new AppError("Registration is closed because the draw has been enabled.");
        if ((await this.needsRosterReview()))
            throw new AppError("The administrator must match existing accounts to the approved roster before registration can reopen.");
        const person = (await this.db.prepare("SELECT id,name FROM approved_people WHERE lower(name) = ?").get(normalizeName(name))) as {
            id: number;
            name: string;
        } | undefined;
        if (!person)
            throw new AppError("Your name is not on the approved participant list. Enter your full name exactly as shown in your Aria Profile.");
        const claimed = async () => (await this.db.prepare("SELECT id FROM users WHERE approved_person_id = ?").get(person.id));
        if ((await claimed()))
            throw new AppError("An account for this participant already exists. Please sign in or request a password reset.");
        const hash = await bcrypt.hash(password, 12);
        const answerHash = answer === null ? null : await bcrypt.hash(answer, 12);
        return (await this.transaction(async () => {
            if ((await this.enabled()))
                throw new AppError("Registration is closed because the draw has been enabled.");
            if ((await this.needsRosterReview()))
                throw new AppError("The administrator must review existing accounts before registration can reopen.");
            // An administrator may remove the candidate while bcrypt is running.
            const currentPerson = (await this.db.prepare("SELECT name FROM approved_people WHERE id = ?").get(person.id));
            if (!currentPerson || currentPerson.name !== person.name)
                throw new AppError("Your name is no longer on the approved participant list. Contact the administrator.");
            if ((await claimed()))
                throw new AppError("An account for this participant already exists. Please sign in or request a password reset.");
            const id = randomUUID();
            (await this.db.prepare(`INSERT INTO users(id,name_key,name,password_hash,approved_person_id,recovery_question,recovery_answer_hash)
        VALUES(?,?,?,?,?,?,?)`).run(id, normalizeName(person.name), person.name, hash, person.id, hasRecovery ? recoveryQuestion : null, answerHash));
            return (await this.user(id))!;
        }));
    }
    async login(name: string, password: string) {
        const nameKey = normalizeName(name);
        (await this.throttle("name:" + nameKey));
        const row = (await this.db.prepare("SELECT * FROM users WHERE name_key = ?").get(nameKey)) as UserRow | undefined;
        // Always do bcrypt work, including for unknown accounts.
        const hash = row?.password_hash ?? ((await this.db.prepare("SELECT password_hash FROM users WHERE admin = 1").get())!.password_hash as string);
        const matches = await bcrypt.compare(password, hash);
        if (!row) {
            const approved = (await this.db.prepare("SELECT 1 FROM approved_people WHERE lower(name) = ?").get(nameKey));
            if (approved)
                throw new AppError("No account exists for this name. Please create an account.");
            throw new AppError("Name not recognized. Enter your full name as shown in your Aria Profile.");
        }
        if (!matches || Buffer.byteLength(password) > 72)
            throw new AppError("Incorrect password. Try again or reset your password.");
        (await this.clearThrottle("name:" + nameKey));
        return publicUser(row);
    }
    async createSession(userId: string) {
        const token = randomBytes(32).toString("base64url");
        (await this.db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now()));
        (await this.db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(tokenHash(token), userId, Date.now() + SESSION_SECONDS * 1000));
        return token;
    }
    async session(token: string) {
        const row = (await this.db.prepare(`SELECT users.* FROM users JOIN sessions ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires > ?`).get(tokenHash(token), Date.now())) as UserRow | undefined;
        return row ? publicUser(row) : undefined;
    }
    async logout(token: string) { (await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token))); }
    async hasRecovery(userId: string) {
        return Boolean((await this.db.prepare("SELECT 1 FROM users WHERE id = ? AND recovery_question IS NOT NULL AND recovery_answer_hash IS NOT NULL").get(userId)));
    }
    async resetPassword(name: string, question: string, answer: string, newPassword: string) {
        const nameKey = normalizeName(name);
        (await this.throttle("recovery-reset:" + nameKey));
        const normalized = validateRecovery(question, answer);
        if (newPassword.length < 8 || Buffer.byteLength(newPassword) > 72)
            throw new AppError("Use at least 8 characters and at most 72 UTF-8 bytes for your new password.");
        const user = (await this.db.prepare("SELECT * FROM users WHERE name_key = ? AND admin = 0").get(nameKey)) as UserRow | undefined;
        const hash = user?.recovery_answer_hash ?? String((await this.db.prepare("SELECT password_hash FROM users WHERE admin = 1").get())!.password_hash);
        const matches = await bcrypt.compare(normalized, hash);
        const invalid = () => new AppError("The name, recovery question, or answer is incorrect, or a recovery hint has not been set up.");
        if (!user?.recovery_answer_hash || user.recovery_question !== question || !matches)
            throw invalid();
        const passwordHash = await bcrypt.hash(newPassword, 12);
        (await this.transaction(async () => {
            const result = (await this.db.prepare(`UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?
        AND recovery_question = ? AND recovery_answer_hash = ?`)
                .run(passwordHash, user.id, user.password_hash, question, user.recovery_answer_hash));
            if (result.changes !== 1)
                throw invalid();
            (await this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id));
            (await this.db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(user.id));
            (await this.db.prepare("DELETE FROM attempts WHERE key = ?").run("name:" + nameKey));
        }));
    }
    async issuePasswordReset(adminId: string, userId: string) {
        if (!(await this.user(adminId))?.admin)
            throw new AppError("Only the administrator can generate reset links.");
        const participant = (await this.user(userId));
        if (!participant || participant.admin)
            throw new AppError("Choose a participant account. Admin credentials are managed in server configuration.");
        (await this.throttle("issue-reset-link:" + adminId + ":" + userId));
        const token = randomBytes(32).toString("base64url");
        (await this.db.prepare(`INSERT INTO password_resets(token_hash,user_id,expires) VALUES(?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, expires = excluded.expires`)
            .run(tokenHash(token), userId, Date.now() + 30 * 60000));
        return token;
    }
    async resetLinkInfo(token: string): Promise<{
        name: string;
        expires: number;
    } | undefined> {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token))
            return;
        const row = (await this.db.prepare(`SELECT users.name,password_resets.expires FROM password_resets
      JOIN users ON users.id = password_resets.user_id
      WHERE token_hash = ? AND expires > ? AND users.admin = 0`).get(tokenHash(token), Date.now()));
        return row ? { name: String(row.name), expires: Number(row.expires) } : undefined;
    }
    async completePasswordReset(token: string, newPassword: string) {
        const invalid = () => new AppError("This reset link has already been used or has expired. Ask the administrator for a new link.");
        if (!(await this.resetLinkInfo(token)))
            throw invalid();
        (await this.throttle("complete-reset-link:" + tokenHash(token)));
        if (newPassword.length < 8 || Buffer.byteLength(newPassword) > 72)
            throw new AppError("Use at least 8 characters and at most 72 UTF-8 bytes for the new password.");
        const hash = await bcrypt.hash(newPassword, 12);
        (await this.transaction(async () => {
            // Recheck after hashing, under the write lock: expiry, regeneration, and
            // competing submissions can invalidate a link while hashing is in flight.
            const reset = (await this.db.prepare(`SELECT users.id,users.name FROM password_resets JOIN users ON users.id = password_resets.user_id
        WHERE token_hash = ? AND expires > ? AND users.admin = 0`).get(tokenHash(token), Date.now()));
            if (!reset)
                throw invalid();
            (await this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, reset.id));
            (await this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(reset.id));
            (await this.db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(reset.id));
            (await this.db.prepare("DELETE FROM attempts WHERE key = ?").run("name:" + normalizeName(String(reset.name))));
        }));
    }
    async saveWishlist(userId: string, wishlist: string) {
        const user = (await this.user(userId));
        if (!user || user.admin)
            throw new AppError("Only participants can save a wishlist.");
        if (wishlist.length > 5000)
            throw new AppError("Keep your wishlist under 5,000 characters.");
        (await this.transaction(async () => {
            if ((await this.enabled()))
                throw new AppError("Wishlists are locked because the draw has started.");
            (await this.db.prepare("UPDATE users SET wishlist = ? WHERE id = ?").run(wishlist.trim(), userId));
        }));
    }
    async enableDraw(adminId: string) {
        if (!(await this.user(adminId))?.admin)
            throw new AppError("Only the administrator can enable the draw.");
        return (await this.transaction(async () => {
            if ((await this.enabled()))
                throw new AppError("The draw is already enabled. Use the protected reset process to reopen it.");
            if ((await this.needsRosterReview()))
                throw new AppError("Match all existing accounts to the approved roster before enabling the draw.");
            const participants = (await this.participants());
            if (participants.length < 2)
                throw new AppError("At least two participants must register before enabling the draw.");
            // Rejection sampling of Fisher–Yates gives a uniform random derangement.
            const ids = participants.map(p => p.id);
            let recipients: string[];
            do {
                recipients = [...ids];
                for (let i = recipients.length - 1; i > 0; i--) {
                    const j = randomInt(i + 1);
                    [recipients[i], recipients[j]] = [recipients[j], recipients[i]];
                }
            } while (recipients.some((id, i) => id === ids[i]));
            const insert = this.db.prepare("INSERT INTO assignments(giver,recipient) VALUES(?,?)");
            for (const [i, id] of ids.entries())
                await insert.run(id, recipients[i]);
            (await this.db.prepare("UPDATE exchange SET enabled = 1, revision = revision + 1 WHERE id = 1").run());
            (await this.db.prepare("DELETE FROM draw_reset_requests").run());
        }));
    }
    async prepareDrawReset(adminId: string, input: {
        password: string;
        reason: string;
        understood: boolean;
        notified: boolean;
        sessionToken: string;
        revision: number;
    }) {
        const admin = (await this.db.prepare("SELECT * FROM users WHERE id = ? AND admin = 1").get(adminId)) as UserRow | undefined;
        if (!admin || (await this.session(input.sessionToken))?.id !== adminId)
            throw new AppError("Only the signed-in administrator can reset the draw.");
        if (!(await this.enabled()))
            throw new AppError("The draw is already closed. There is nothing to reset.");
        if (input.revision !== (await this.drawRevision()))
            throw new AppError("The draw changed. Refresh the dashboard and start again.");
        const reason = input.reason.trim();
        if (!input.understood || !input.notified)
            throw new AppError("Acknowledge the consequences and confirm that all participants have been informed.");
        if (reason.length < 10 || reason.length > 500)
            throw new AppError("Enter a reset reason between 10 and 500 characters.");
        (await this.throttle("draw-reset-password:" + adminId, 5));
        if (Buffer.byteLength(input.password) > 72 || !await bcrypt.compare(input.password, admin.password_hash))
            throw new AppError("Incorrect administrator password. The draw has not been changed.");
        return (await this.transaction(async () => {
            const current = (await this.db.prepare("SELECT password_hash FROM users WHERE id = ? AND admin = 1").get(adminId));
            if (!current || current.password_hash !== admin.password_hash || (await this.session(input.sessionToken))?.id !== adminId)
                throw new AppError("Your administrator session changed. Sign in and start again.");
            if (!(await this.enabled()) || input.revision !== (await this.drawRevision()))
                throw new AppError("The draw changed. Refresh the dashboard and start again.");
            const revision = (await this.drawRevision());
            const token = randomBytes(32).toString("base64url");
            const expires = Date.now() + 5 * 60000;
            (await this.db.prepare("DELETE FROM draw_reset_requests WHERE admin_id = ? OR expires <= ?").run(adminId, Date.now()));
            (await this.db.prepare("INSERT INTO draw_reset_requests(token_hash,admin_id,session_hash,revision,credential_hash,reason,expires) VALUES(?,?,?,?,?,?,?)")
                .run(tokenHash(token), adminId, tokenHash(input.sessionToken), revision, tokenHash(admin.password_hash), reason, expires));
            return { token, expires, participantCount: (await this.participants()).length };
        }));
    }
    private async validDrawReset(adminId: string, sessionToken: string, token: string) {
        const admin = (await this.db.prepare("SELECT password_hash FROM users WHERE id = ? AND admin = 1").get(adminId));
        if (!admin || (await this.session(sessionToken))?.id !== adminId)
            throw new AppError("Only the signed-in administrator can reset the draw.");
        if (!/^[A-Za-z0-9_-]{43}$/.test(token))
            throw new AppError("Reset approval is invalid or expired. Start again.");
        const request = (await this.db.prepare(`SELECT r.reason,r.revision FROM draw_reset_requests r
      JOIN users u ON u.id = r.admin_id JOIN exchange e ON e.id = 1
      WHERE r.token_hash = ? AND r.admin_id = ? AND r.session_hash = ? AND r.expires > ?
        AND u.admin = 1 AND e.enabled = 1 AND r.revision = e.revision AND r.credential_hash = ?`)
            .get(tokenHash(token), adminId, tokenHash(sessionToken), Date.now(), tokenHash(String(admin.password_hash))));
        if (!request)
            throw new AppError("Reset approval is expired, already used, or the draw has changed. Start again.");
        return { reason: String(request.reason), revision: Number(request.revision) };
    }
    async resetDraw(adminId: string, sessionToken: string, token: string, phrase: string, confirmed: boolean) {
        (await this.validDrawReset(adminId, sessionToken, token));
        (await this.throttle("draw-reset-confirm:" + adminId, 10));
        if (phrase !== "RESET DRAW" || !confirmed)
            throw new AppError("Type RESET DRAW exactly and confirm the final warning. The draw has not been changed.");
        return (await this.transaction(async () => {
            // Recheck under the write lock: a competing reset/redraw must never be cleared.
            const approval = (await this.validDrawReset(adminId, sessionToken, token));
            const backupId = randomUUID();
            const snapshot: Record<string, unknown> = {};
            for (const table of ["users", "approved_people", "exchange", "assignments", "sessions", "password_resets", "attempts", "draw_reset_requests", "draw_reset_history"]) {
                snapshot[table] = await this.db.prepare('SELECT * FROM ' + table).all();
            }
            const backupPath = 'postgres:draw_backups/' + backupId;
            await this.db.prepare('INSERT INTO draw_backups(id,created,snapshot) VALUES(?,?,?::jsonb)').run(backupId, Date.now(), JSON.stringify(snapshot));
            const participantCount = (await this.participants()).length;
            (await this.db.prepare("INSERT INTO draw_reset_history VALUES(?,?,?,?,?,?,?,?)")
                .run(randomUUID(), adminId, (await this.user(adminId))!.name, approval.reason, approval.revision, participantCount, Date.now(), backupPath));
            (await this.db.prepare("DELETE FROM assignments").run());
            (await this.db.prepare("UPDATE exchange SET enabled = 0, revision = revision + 1 WHERE id = 1").run());
            (await this.db.prepare("DELETE FROM draw_reset_requests").run());
            return { backupPath, participantCount };
        }));
    }
    async reveal(userId: string): Promise<Match> {
        const user = (await this.user(userId));
        if (!user || user.admin)
            throw new AppError("Only participants can draw a name.");
        if (!(await this.enabled()))
            throw new AppError("The administrator has not enabled the draw yet.");
        const match = (await this.db.prepare(`SELECT users.name,users.wishlist FROM assignments
      JOIN users ON users.id = assignments.recipient WHERE assignments.giver = ?`).get(userId)) as Match | undefined;
        if (!match)
            throw new AppError("Your match is unavailable.");
        return { name: match.name, wishlist: match.wishlist };
    }
}
