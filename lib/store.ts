import { DatabaseSync, backup } from "node:sqlite";
import { chmodSync, mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import recoveryQuestions from "./recovery-questions.json" with { type: "json" };

import { AppError, type User, type UserRow, type Match } from "./store-types.ts";
export { AppError, type User, type Match } from "./store-types.ts";
const publicUser = (row: UserRow): User => ({ id: row.id, name: row.name, admin: Boolean(row.admin), wishlist: row.wishlist });
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const normalizeAnswer = (answer: string) => answer.trim().replace(/\s+/g, " ").toLowerCase();
function validateRecovery(question: string, answer: string) {
  if (!Object.hasOwn(recoveryQuestions, question)) throw new AppError("Choose a recovery question.");
  const normalized = normalizeAnswer(answer);
  if (normalized.length < 2 || Buffer.byteLength(normalized) > 72)
    throw new AppError("Use a recovery answer with at least 2 characters and at most 72 UTF-8 bytes.");
  return normalized;
}
export { SESSION_SECONDS } from "./store-types.ts";
import { SESSION_SECONDS } from "./store-types.ts";

export class SantaStore {
  db: DatabaseSync;
  readonly filename: string;
  constructor(filename: string, adminName: string, adminPassword: string, initialApprovedNames: readonly string[] = []) {
    this.filename = filename;
    if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.migrateNameLogin(adminName);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL, password_hash TEXT NOT NULL,
        admin INTEGER NOT NULL DEFAULT 0 CHECK(admin IN (0,1)), wishlist TEXT NOT NULL DEFAULT '',
        approved_person_id INTEGER REFERENCES approved_people(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_admin ON users(admin) WHERE admin = 1;
      CREATE TABLE IF NOT EXISTS exchange (id INTEGER PRIMARY KEY CHECK(id = 1), enabled INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO exchange(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS assignments (
        giver TEXT PRIMARY KEY REFERENCES users(id), recipient TEXT NOT NULL UNIQUE REFERENCES users(id),
        CHECK(giver != recipient)
      );
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS password_resets (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id), expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL);
      DELETE FROM attempts WHERE key LIKE 'email:%';
      CREATE TABLE IF NOT EXISTS approved_people (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS draw_reset_requests (
        token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES users(id), session_hash TEXT NOT NULL,
        revision INTEGER NOT NULL, credential_hash TEXT NOT NULL, reason TEXT NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS draw_reset_history (
        id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, admin_name TEXT NOT NULL, reason TEXT NOT NULL,
        revision INTEGER NOT NULL, participant_count INTEGER NOT NULL, created INTEGER NOT NULL, backup_path TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS participant_assignment BEFORE INSERT ON assignments
        WHEN (SELECT admin FROM users WHERE id = NEW.giver) = 1 OR (SELECT admin FROM users WHERE id = NEW.recipient) = 1
        BEGIN SELECT RAISE(ABORT, 'Admin cannot participate'); END;
    `);
    this.transaction(() => {
      if (!this.db.prepare("PRAGMA table_info(exchange)").all().some(column => column.name === "revision"))
        this.db.exec("ALTER TABLE exchange ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
      // Optional runtime seed. Production starts empty; names belong in the DB.
      // Restarting must not restore names the administrator removed.
      if (!this.db.prepare("SELECT 1 FROM app_settings WHERE key = 'roster_seeded'").get()) {
        const seed = this.db.prepare("INSERT OR IGNORE INTO approved_people(name) VALUES(?)");
        initialApprovedNames.forEach(name => seed.run(name));
        this.db.prepare("INSERT INTO app_settings(key,value) VALUES('roster_seeded','1')").run();
      }
      const columns = this.db.prepare("PRAGMA table_info(users)").all();
      if (!columns.some(column => column.name === "approved_person_id"))
        this.db.exec("ALTER TABLE users ADD COLUMN approved_person_id INTEGER REFERENCES approved_people(id)");
      if (!columns.some(column => column.name === "recovery_question"))
        this.db.exec("ALTER TABLE users ADD COLUMN recovery_question TEXT");
      if (!columns.some(column => column.name === "recovery_answer_hash"))
        this.db.exec("ALTER TABLE users ADD COLUMN recovery_answer_hash TEXT");
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS one_account_per_person ON users(approved_person_id);
        UPDATE users SET approved_person_id = (SELECT id FROM approved_people WHERE name = trim(users.name) COLLATE NOCASE)
        WHERE admin = 0 AND approved_person_id IS NULL
          AND EXISTS (SELECT 1 FROM approved_people WHERE name = trim(users.name) COLLATE NOCASE)
          AND (SELECT count(*) FROM users duplicate WHERE duplicate.admin = 0 AND lower(trim(duplicate.name)) = lower(trim(users.name))) = 1
          AND NOT EXISTS (SELECT 1 FROM users other WHERE other.approved_person_id = (SELECT id FROM approved_people WHERE name = trim(users.name) COLLATE NOCASE));
        CREATE TRIGGER IF NOT EXISTS approved_signup BEFORE INSERT ON users WHEN NEW.admin = 0 AND
          (NEW.approved_person_id IS NULL OR NOT EXISTS (SELECT 1 FROM approved_people WHERE id = NEW.approved_person_id AND name = NEW.name COLLATE NOCASE))
          BEGIN SELECT RAISE(ABORT, 'An approved participant name is required'); END;
        CREATE TRIGGER IF NOT EXISTS approved_name_update BEFORE UPDATE OF name,approved_person_id ON users WHEN NEW.admin = 0 AND
          (NEW.approved_person_id IS NULL OR NOT EXISTS (SELECT 1 FROM approved_people WHERE id = NEW.approved_person_id AND name = NEW.name COLLATE NOCASE))
          BEGIN SELECT RAISE(ABORT, 'An approved participant name is required'); END;`);
    });
    if (Buffer.byteLength(adminPassword) < 8 || Buffer.byteLength(adminPassword) > 72) throw new Error("ADMIN_PASSWORD must be between 8 and 72 UTF-8 bytes.");
    const existing = this.db.prepare("SELECT * FROM users WHERE admin = 1").get() as UserRow | undefined;
    const name = adminName.trim().replace(/\s+/g, " ");
    const nameKey = normalizeName(name);
    if (!nameKey || name.length > 80 || this.approvedPeople().some(person => normalizeName(person.name) === nameKey))
      throw new Error("ADMIN_NAME must be a distinct admin name, separate from the approved participants.");
    if (!existing) {
      this.db.prepare("INSERT INTO users(id,name_key,name,password_hash,admin) VALUES(?,?,?,?,1)")
        .run(randomUUID(), nameKey, name, bcrypt.hashSync(adminPassword, 12));
    } else if (existing.name !== name || !bcrypt.compareSync(adminPassword, existing.password_hash)) {
      this.db.prepare("UPDATE users SET name_key = ?, name = ?, password_hash = ? WHERE id = ?")
        .run(nameKey, name, bcrypt.hashSync(adminPassword, 12), existing.id);
      this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
    }
  }
  private migrateNameLogin(adminName: string) {
    const columns = this.db.prepare("PRAGMA table_info(users)").all();
    if (!columns.length || (columns.some(column => column.name === "name_key") && !columns.some(column => column.name === "email"))) return;
    this.db.exec("PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000");
    try {
      this.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS approved_people (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
          CREATE TABLE users_name_login (
            id TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
            admin INTEGER NOT NULL DEFAULT 0 CHECK(admin IN (0,1)), wishlist TEXT NOT NULL DEFAULT '',
            approved_person_id INTEGER REFERENCES approved_people(id)
          )`);
        const insert = this.db.prepare("INSERT INTO users_name_login VALUES(?,?,?,?,?,?,?)");
        for (const row of this.db.prepare("SELECT * FROM users").all()) {
          const name = row.admin ? adminName.trim().replace(/\s+/g, " ") : String(row.name);
          insert.run(row.id, normalizeName(name), name, row.password_hash, row.admin, row.wishlist, row.approved_person_id ?? null);
        }
        this.db.exec(`DROP TRIGGER IF EXISTS participant_assignment;
          DROP TABLE users; ALTER TABLE users_name_login RENAME TO users`);
        if (this.db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Name-login migration failed its foreign-key check.");
      });
    } finally { this.db.exec("PRAGMA foreign_keys = ON"); }
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = fn(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  enabled() { return Boolean(this.db.prepare("SELECT enabled FROM exchange WHERE id = 1").get()!.enabled); }
  drawRevision() { return Number(this.db.prepare("SELECT revision FROM exchange WHERE id = 1").get()!.revision); }
  user(id: string) {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? publicUser(row) : undefined;
  }
  participants() {
    return this.db.prepare("SELECT id,name,approved_person_id FROM users WHERE admin = 0 ORDER BY name").all() as { id: string; name: string; approved_person_id: number | null }[];
  }
  approvedPeople() {
    return this.db.prepare("SELECT id,name FROM approved_people ORDER BY name").all() as { id: number; name: string }[];
  }
  addPerson(adminId: string, input: string) {
    return this.transaction(() => {
      if (!this.user(adminId)?.admin) throw new AppError("Only the administrator can manage participants.");
      if (this.enabled()) throw new AppError("Participants cannot be changed after the draw has started.");
      const name = input.trim().replace(/\s+/g, " ");
      if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))
        throw new AppError("Enter the full name from the Aria Profile, using up to 80 characters.");
      const key = normalizeName(name);
      if (this.approvedPeople().some(person => normalizeName(person.name) === key) ||
          this.db.prepare("SELECT 1 FROM users WHERE name_key = ?").get(key))
        throw new AppError("That name is already in use. Each person can be added only once.");
      this.db.prepare("INSERT INTO approved_people(name) VALUES(?)").run(name);
    });
  }
  removePerson(adminId: string, personId: number, expectedName: string) {
    return this.transaction(() => {
      if (!this.user(adminId)?.admin) throw new AppError("Only the administrator can manage participants.");
      if (this.enabled()) throw new AppError("Participants cannot be changed after the draw has started.");
      const person = this.db.prepare("SELECT name FROM approved_people WHERE id = ?").get(personId);
      if (!person || person.name !== expectedName) throw new AppError("The approved list has changed. Refresh the dashboard before deleting anyone.");
      const user = this.db.prepare("SELECT id,admin FROM users WHERE approved_person_id = ?").get(personId);
      if (user?.admin) throw new AppError("The administrator account cannot be removed.");
      if (user) {
        this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
        this.db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(user.id);
        this.db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
      }
      const key = normalizeName(String(person.name));
      this.db.prepare("DELETE FROM attempts WHERE key IN (?,?)").run("name:" + key, "recovery-reset:" + key);
      this.db.prepare("DELETE FROM approved_people WHERE id = ?").run(personId);
    });
  }
  needsRosterReview() {
    return Boolean(this.db.prepare("SELECT 1 FROM users WHERE admin = 0 AND approved_person_id IS NULL LIMIT 1").get());
  }
  linkParticipant(adminId: string, userId: string, personId: number) {
    if (!this.user(adminId)?.admin) throw new AppError("Only the administrator can match existing accounts.");
    return this.transaction(() => {
      const participant = this.db.prepare("SELECT id FROM users WHERE id = ? AND admin = 0 AND approved_person_id IS NULL").get(userId);
      const person = this.db.prepare("SELECT name FROM approved_people WHERE id = ?").get(personId);
      if (!participant || !person) throw new AppError("Select an unmatched account and an approved name.");
      if (this.db.prepare("SELECT id FROM users WHERE approved_person_id = ?").get(personId)) throw new AppError("That person already has an account.");
      this.db.prepare("UPDATE users SET name = ?, name_key = ?, approved_person_id = ? WHERE id = ?").run(person.name, normalizeName(String(person.name)), personId, userId);
    });
  }
  // Persistent throttling survives restarts and is shared by app processes.
  throttle(key: string, limit = 10) {
    const now = Date.now();
    this.db.prepare("DELETE FROM attempts WHERE reset <= ?").run(now);
    const attempt = this.db.prepare(`INSERT INTO attempts(key,count,reset) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`).get(key, now + 15 * 60_000)!;
    if (Number(attempt.count) > limit) throw new AppError("Too many attempts. Try again in 15 minutes.");
  }
  clearThrottle(key: string) { this.db.prepare("DELETE FROM attempts WHERE key = ?").run(key); }
  async register(name: string, password: string, recoveryQuestion = "", recoveryAnswer = "") {
    if (!name.trim() || name.trim().length > 80) throw new AppError("Enter your full name as shown in your Aria Profile.");
    if (password.length < 8 || Buffer.byteLength(password) > 72) throw new AppError("Use at least 8 characters and at most 72 UTF-8 bytes for your password.");
    const hasRecovery = Boolean(recoveryQuestion.trim() || recoveryAnswer.trim());
    const answer = hasRecovery ? validateRecovery(recoveryQuestion, recoveryAnswer) : null;
    if (this.enabled()) throw new AppError("Registration is closed because the draw has been enabled.");
    if (this.needsRosterReview()) throw new AppError("The administrator must match existing accounts to the approved roster before registration can reopen.");
    const person = this.db.prepare("SELECT id,name FROM approved_people WHERE lower(name) = ?").get(normalizeName(name)) as { id: number; name: string } | undefined;
    if (!person) throw new AppError("Your name is not on the approved participant list. Enter your full name exactly as shown in your Aria Profile.");
    const claimed = () => this.db.prepare("SELECT id FROM users WHERE approved_person_id = ?").get(person.id);
    if (claimed()) throw new AppError("An account for this participant already exists. Please sign in or request a password reset.");
    const hash = await bcrypt.hash(password, 12);
    const answerHash = answer === null ? null : await bcrypt.hash(answer, 12);
    return this.transaction(() => {
      if (this.enabled()) throw new AppError("Registration is closed because the draw has been enabled.");
      if (this.needsRosterReview()) throw new AppError("The administrator must review existing accounts before registration can reopen.");
      // An administrator may remove the candidate while bcrypt is running.
      const currentPerson = this.db.prepare("SELECT name FROM approved_people WHERE id = ?").get(person.id);
      if (!currentPerson || currentPerson.name !== person.name)
        throw new AppError("Your name is no longer on the approved participant list. Contact the administrator.");
      if (claimed()) throw new AppError("An account for this participant already exists. Please sign in or request a password reset.");
      const id = randomUUID();
      this.db.prepare(`INSERT INTO users(id,name_key,name,password_hash,approved_person_id,recovery_question,recovery_answer_hash)
        VALUES(?,?,?,?,?,?,?)`).run(id, normalizeName(person.name), person.name, hash, person.id, hasRecovery ? recoveryQuestion : null, answerHash);
      return this.user(id)!;
    });
  }
  async login(name: string, password: string) {
    const nameKey = normalizeName(name);
    this.throttle("name:" + nameKey);
    const row = this.db.prepare("SELECT * FROM users WHERE name_key = ?").get(nameKey) as UserRow | undefined;
    // Always do bcrypt work, including for unknown accounts.
    const hash = row?.password_hash ?? (this.db.prepare("SELECT password_hash FROM users WHERE admin = 1").get()!.password_hash as string);
    const matches = await bcrypt.compare(password, hash);
    if (!row) {
      const approved = this.db.prepare("SELECT 1 FROM approved_people WHERE lower(name) = ?").get(nameKey);
      if (approved) throw new AppError("No account exists for this name. Please create an account.");
      throw new AppError("Name not recognized. Enter your full name as shown in your Aria Profile.");
    }
    if (!matches || Buffer.byteLength(password) > 72) throw new AppError("Incorrect password. Try again or reset your password.");
    this.clearThrottle("name:" + nameKey);
    return publicUser(row);
  }
  createSession(userId: string) {
    const token = randomBytes(32).toString("base64url");
    this.db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
    this.db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(tokenHash(token), userId, Date.now() + SESSION_SECONDS * 1000);
    return token;
  }
  session(token: string) {
    const row = this.db.prepare(`SELECT users.* FROM users JOIN sessions ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires > ?`).get(tokenHash(token), Date.now()) as UserRow | undefined;
    return row ? publicUser(row) : undefined;
  }
  logout(token: string) { this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token)); }
  hasRecovery(userId: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM users WHERE id = ? AND recovery_question IS NOT NULL AND recovery_answer_hash IS NOT NULL").get(userId));
  }
  async resetPassword(name: string, question: string, answer: string, newPassword: string) {
    const nameKey = normalizeName(name);
    this.throttle("recovery-reset:" + nameKey);
    const normalized = validateRecovery(question, answer);
    if (newPassword.length < 8 || Buffer.byteLength(newPassword) > 72)
      throw new AppError("Use at least 8 characters and at most 72 UTF-8 bytes for your new password.");
    const user = this.db.prepare("SELECT * FROM users WHERE name_key = ? AND admin = 0").get(nameKey) as UserRow | undefined;
    const hash = user?.recovery_answer_hash ?? String(this.db.prepare("SELECT password_hash FROM users WHERE admin = 1").get()!.password_hash);
    const matches = await bcrypt.compare(normalized, hash);
    const invalid = () => new AppError("The name, recovery question, or answer is incorrect, or a recovery hint has not been set up.");
    if (!user?.recovery_answer_hash || user.recovery_question !== question || !matches) throw invalid();
    const passwordHash = await bcrypt.hash(newPassword, 12);
    this.transaction(() => {
      const result = this.db.prepare(`UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?
        AND recovery_question = ? AND recovery_answer_hash = ?`)
        .run(passwordHash, user.id, user.password_hash, question, user.recovery_answer_hash);
      if (result.changes !== 1) throw invalid();
      this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
      this.db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(user.id);
      this.db.prepare("DELETE FROM attempts WHERE key = ?").run("name:" + nameKey);
    });
  }
  issuePasswordReset(adminId: string, userId: string) {
    if (!this.user(adminId)?.admin) throw new AppError("Only the administrator can generate reset links.");
    const participant = this.user(userId);
    if (!participant || participant.admin) throw new AppError("Choose a participant account. Admin credentials are managed in server configuration.");
    this.throttle("issue-reset-link:" + adminId + ":" + userId);
    const token = randomBytes(32).toString("base64url");
    this.db.prepare(`INSERT INTO password_resets(token_hash,user_id,expires) VALUES(?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, expires = excluded.expires`)
      .run(tokenHash(token), userId, Date.now() + 30 * 60_000);
    return token;
  }
  resetLinkInfo(token: string): { name: string; expires: number } | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const row = this.db.prepare(`SELECT users.name,password_resets.expires FROM password_resets
      JOIN users ON users.id = password_resets.user_id
      WHERE token_hash = ? AND expires > ? AND users.admin = 0`).get(tokenHash(token), Date.now());
    return row ? { name: String(row.name), expires: Number(row.expires) } : undefined;
  }
  async completePasswordReset(token: string, newPassword: string) {
    const invalid = () => new AppError("This reset link has already been used or has expired. Ask the administrator for a new link.");
    if (!this.resetLinkInfo(token)) throw invalid();
    this.throttle("complete-reset-link:" + tokenHash(token));
    if (newPassword.length < 8 || Buffer.byteLength(newPassword) > 72)
      throw new AppError("Use at least 8 characters and at most 72 UTF-8 bytes for the new password.");
    const hash = await bcrypt.hash(newPassword, 12);
    this.transaction(() => {
      // Recheck after hashing, under the write lock: expiry, regeneration, and
      // competing submissions can invalidate a link while hashing is in flight.
      const reset = this.db.prepare(`SELECT users.id,users.name FROM password_resets JOIN users ON users.id = password_resets.user_id
        WHERE token_hash = ? AND expires > ? AND users.admin = 0`).get(tokenHash(token), Date.now());
      if (!reset) throw invalid();
      this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, reset.id);
      this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(reset.id);
      this.db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(reset.id);
      this.db.prepare("DELETE FROM attempts WHERE key = ?").run("name:" + normalizeName(String(reset.name)));
    });
  }
  saveWishlist(userId: string, wishlist: string) {
    const user = this.user(userId);
    if (!user || user.admin) throw new AppError("Only participants can save a wishlist.");
    if (wishlist.length > 5000) throw new AppError("Keep your wishlist under 5,000 characters.");
    this.transaction(() => {
      if (this.enabled()) throw new AppError("Wishlists are locked because the draw has started.");
      this.db.prepare("UPDATE users SET wishlist = ? WHERE id = ?").run(wishlist.trim(), userId);
    });
  }
  enableDraw(adminId: string) {
    if (!this.user(adminId)?.admin) throw new AppError("Only the administrator can enable the draw.");
    return this.transaction(() => {
      if (this.enabled()) throw new AppError("The draw is already enabled. Use the protected reset process to reopen it.");
      if (this.needsRosterReview()) throw new AppError("Match all existing accounts to the approved roster before enabling the draw.");
      const participants = this.participants();
      if (participants.length < 2) throw new AppError("At least two participants must register before enabling the draw.");
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
      ids.forEach((id, i) => insert.run(id, recipients[i]));
      this.db.prepare("UPDATE exchange SET enabled = 1, revision = revision + 1 WHERE id = 1").run();
      this.db.prepare("DELETE FROM draw_reset_requests").run();
    });
  }
  async prepareDrawReset(adminId: string, input: { password: string; reason: string; understood: boolean; notified: boolean; sessionToken: string; revision: number }) {
    const admin = this.db.prepare("SELECT * FROM users WHERE id = ? AND admin = 1").get(adminId) as UserRow | undefined;
    if (!admin || this.session(input.sessionToken)?.id !== adminId) throw new AppError("Only the signed-in administrator can reset the draw.");
    if (!this.enabled()) throw new AppError("The draw is already closed. There is nothing to reset.");
    if (input.revision !== this.drawRevision()) throw new AppError("The draw changed. Refresh the dashboard and start again.");
    const reason = input.reason.trim();
    if (!input.understood || !input.notified) throw new AppError("Acknowledge the consequences and confirm that all participants have been informed.");
    if (reason.length < 10 || reason.length > 500) throw new AppError("Enter a reset reason between 10 and 500 characters.");
    this.throttle("draw-reset-password:" + adminId, 5);
    if (Buffer.byteLength(input.password) > 72 || !await bcrypt.compare(input.password, admin.password_hash))
      throw new AppError("Incorrect administrator password. The draw has not been changed.");
    return this.transaction(() => {
      const current = this.db.prepare("SELECT password_hash FROM users WHERE id = ? AND admin = 1").get(adminId);
      if (!current || current.password_hash !== admin.password_hash || this.session(input.sessionToken)?.id !== adminId)
        throw new AppError("Your administrator session changed. Sign in and start again.");
      if (!this.enabled() || input.revision !== this.drawRevision()) throw new AppError("The draw changed. Refresh the dashboard and start again.");
      const revision = this.drawRevision();
      const token = randomBytes(32).toString("base64url");
      const expires = Date.now() + 5 * 60_000;
      this.db.prepare("DELETE FROM draw_reset_requests WHERE admin_id = ? OR expires <= ?").run(adminId, Date.now());
      this.db.prepare("INSERT INTO draw_reset_requests(token_hash,admin_id,session_hash,revision,credential_hash,reason,expires) VALUES(?,?,?,?,?,?,?)")
        .run(tokenHash(token), adminId, tokenHash(input.sessionToken), revision, tokenHash(admin.password_hash), reason, expires);
      return { token, expires, participantCount: this.participants().length };
    });
  }
  private validDrawReset(adminId: string, sessionToken: string, token: string) {
    const admin = this.db.prepare("SELECT password_hash FROM users WHERE id = ? AND admin = 1").get(adminId);
    if (!admin || this.session(sessionToken)?.id !== adminId)
      throw new AppError("Only the signed-in administrator can reset the draw.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError("Reset approval is invalid or expired. Start again.");
    const request = this.db.prepare(`SELECT r.reason,r.revision FROM draw_reset_requests r
      JOIN users u ON u.id = r.admin_id JOIN exchange e ON e.id = 1
      WHERE r.token_hash = ? AND r.admin_id = ? AND r.session_hash = ? AND r.expires > ?
        AND u.admin = 1 AND e.enabled = 1 AND r.revision = e.revision AND r.credential_hash = ?`)
      .get(tokenHash(token), adminId, tokenHash(sessionToken), Date.now(), tokenHash(String(admin.password_hash)));
    if (!request) throw new AppError("Reset approval is expired, already used, or the draw has changed. Start again.");
    return { reason: String(request.reason), revision: Number(request.revision) };
  }
  async resetDraw(adminId: string, sessionToken: string, token: string, phrase: string, confirmed: boolean) {
    this.validDrawReset(adminId, sessionToken, token);
    this.throttle("draw-reset-confirm:" + adminId, 10);
    if (phrase !== "RESET DRAW" || !confirmed) throw new AppError("Type RESET DRAW exactly and confirm the final warning. The draw has not been changed.");
    const directory = this.filename === ":memory:" ? mkdtempSync(join(tmpdir(), "santa-draw-reset-")) : join(dirname(resolve(this.filename)), "backups");
    const backupPath = join(directory, `before-draw-reset-${Date.now()}-${randomUUID()}.sqlite`);
    // A backup failure must leave the active draw untouched.
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
      await backup(this.db, backupPath);
      chmodSync(backupPath, 0o600);
    } catch { throw new AppError("Could not create the required private backup. The draw has not been changed."); }
    return this.transaction(() => {
      // Recheck under the write lock: a competing reset/redraw must never be cleared.
      const approval = this.validDrawReset(adminId, sessionToken, token);
      const participantCount = this.participants().length;
      this.db.prepare("INSERT INTO draw_reset_history VALUES(?,?,?,?,?,?,?,?)")
        .run(randomUUID(), adminId, this.user(adminId)!.name, approval.reason, approval.revision, participantCount, Date.now(), backupPath);
      this.db.prepare("DELETE FROM assignments").run();
      this.db.prepare("UPDATE exchange SET enabled = 0, revision = revision + 1 WHERE id = 1").run();
      this.db.prepare("DELETE FROM draw_reset_requests").run();
      return { backupPath, participantCount };
    });
  }
  reveal(userId: string): Match {
    const user = this.user(userId);
    if (!user || user.admin) throw new AppError("Only participants can draw a name.");
    if (!this.enabled()) throw new AppError("The administrator has not enabled the draw yet.");
    const match = this.db.prepare(`SELECT users.name,users.wishlist FROM assignments
      JOIN users ON users.id = assignments.recipient WHERE assignments.giver = ?`).get(userId) as Match | undefined;
    if (!match) throw new AppError("Your match is unavailable.");
    return { name: match.name, wishlist: match.wishlist };
  }
}
