import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { SantaStore } from '../lib/store.ts';
import { testRoster as roster } from './helpers/roster.mjs';

const adminName = 'admin';
const adminPassword = 'admin-test-password';
const password = 'participant-test-password';
const create = () => new SantaStore(':memory:', adminName, adminPassword, roster);
const enroll = (db, name, pw) => db.register(name, pw, 'school', 'Maple School');
const admin = db => db.db.prepare('SELECT id FROM users WHERE admin = 1').get().id;
async function participants(db, count = 3) {
  return Promise.all(Array.from({ length: count }, (_, i) => enroll(db,roster[i], password)));
}

test('a fresh production database starts without a roster and retains names added by the admin', t => {
  const dir = mkdtempSync(join(tmpdir(), 'santa-private-roster-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'santa.sqlite');
  const first = new SantaStore(filename, adminName, adminPassword);
  assert.deepEqual(first.approvedPeople(), []);
  first.addPerson(admin(first), 'Example Participant');
  first.db.close();
  const second = new SantaStore(filename, adminName, adminPassword);
  t.after(() => second.db.close());
  assert.deepEqual(second.approvedPeople().map(person => person.name), ['Example Participant']);
});

test('bcrypt hashes, normalized names, reserved admin, and password limits', async t => {
  const db = create(); t.after(() => db.db.close());
  const user = await enroll(db,' Test Participant 01 ', password);
  assert.equal(user.name, 'Test Participant 01');
  assert.equal(user.admin, false);
  assert.equal('password_hash' in user, false);
  const row = db.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  assert.match(row.password_hash, /^\$2[aby]\$12\$/);
  assert.equal(await bcrypt.compare(password, row.password_hash), true);
  await assert.rejects(enroll(db,'TEST PARTICIPANT 01', password), /already exists/);
  await assert.rejects(enroll(db,adminName.toUpperCase(), password), /not on the approved/);
  await assert.rejects(enroll(db,roster[1], '123'), /at least 8/);
  await assert.rejects(enroll(db,roster[1], '😀'.repeat(19)), /72 UTF-8 bytes/);
  assert.equal((await db.login('  Test   Participant   01 ', password)).id, user.id);
  await assert.rejects(db.login(user.name, 'wrong-password'), /Incorrect/);
  await assert.rejects(db.login('Unknown Person', password), /Name not recognized.*Aria Profile/);
  const columns = db.db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  assert.equal(columns.includes('email'), false);
});

test('different approved participants can register simultaneously', async t => {
  const db = create(); t.after(() => db.db.close());
  const results = await Promise.allSettled([enroll(db,roster[0], password), enroll(db,roster[1], password)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
  assert.equal(db.participants().length, 2);
});

test('only admin can add Aria names, with whitespace normalization and duplicate prevention', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user] = await participants(db, 1);
  assert.throws(() => db.addPerson(user.id, 'New Person'), /Only the administrator/);
  assert.throws(() => db.addPerson('forged-id', 'New Person'), /Only the administrator/);
  for (const name of ['', '  ', 'x'.repeat(81), 'Bad\0Name'])
    assert.throws(() => db.addPerson(admin(db), name), /full name/);
  for (const name of ['ADMIN', ' Test   Participant   01 '])
    assert.throws(() => db.addPerson(admin(db), name), /already in use/);
  db.addPerson(admin(db), '  New   Person  ');
  assert.throws(() => db.addPerson(admin(db), 'new person'), /already in use/);
  const added = await db.register('NEW PERSON', password);
  assert.equal(added.name, 'New Person');
  db.saveWishlist(added.id, 'Books');
  assert.equal((await db.login('new person', password)).wishlist, 'Books');
});

test('admin removal deletes a registered account, hints, sessions and reset links without affecting others', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user, other] = await participants(db, 2);
  const person = db.approvedPeople().find(p => p.name === user.name);
  const session = db.createSession(user.id);
  const otherSession = db.createSession(other.id);
  const reset = db.issuePasswordReset(admin(db), user.id);
  db.saveWishlist(user.id, 'Books');
  assert.throws(() => db.removePerson(other.id, person.id, person.name), /Only the administrator/);
  db.removePerson(admin(db), person.id, person.name);
  assert.equal(db.user(user.id), undefined);
  assert.equal(db.hasRecovery(user.id), false);
  assert.equal(db.session(session), undefined);
  assert.equal(db.resetLinkInfo(reset), undefined);
  assert.equal(db.approvedPeople().some(p => p.id === person.id), false);
  assert.equal(db.session(otherSession).id, other.id);
  await assert.rejects(db.register(user.name, password), /not on the approved/);
  await assert.rejects(db.login(user.name, password), /Name not recognized/);
  db.addPerson(admin(db), user.name);
  const replacement = await db.register(user.name, password);
  assert.notEqual(replacement.id, user.id);
  assert.equal(replacement.wishlist, '');
  assert.equal(db.hasRecovery(replacement.id), false);
  assert.equal(db.resetLinkInfo(reset), undefined);
});

test('roster additions and removals persist across restarts, including an empty roster', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'santa-roster-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'santa.sqlite');
  const first = new SantaStore(filename, adminName, adminPassword, roster);
  const person = first.approvedPeople().find(p => p.name === roster[0]);
  first.removePerson(admin(first), person.id, person.name);
  first.addPerson(admin(first), 'New Person');
  first.db.close();
  const second = new SantaStore(filename, adminName, adminPassword, roster);
  assert.equal(second.approvedPeople().some(p => p.name === roster[0]), false);
  assert.equal(second.approvedPeople().some(p => p.name === 'New Person'), true);
  for (const person of second.approvedPeople()) second.removePerson(admin(second), person.id, person.name);
  second.db.close();
  const third = new SantaStore(filename, adminName, adminPassword, roster);
  t.after(() => third.db.close());
  assert.equal(third.approvedPeople().length, 0);
});

test('roster changes are blocked after the draw, including forged and stale requests', async t => {
  const db = create(); t.after(() => db.db.close());
  await participants(db, 2);
  const before = db.approvedPeople();
  db.enableDraw(admin(db));
  assert.throws(() => db.addPerson(admin(db), 'Late Person'), /cannot be changed/);
  assert.throws(() => db.removePerson(admin(db), before[0].id, before[0].name), /cannot be changed/);
  assert.deepEqual(db.approvedPeople(), before);
  assert.equal(db.participants().length, 2);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM assignments').get().n, 2);
});

test('removal during signup prevents registration even if a new candidate reuses the roster id', async t => {
  const db = create(); t.after(() => db.db.close());
  db.addPerson(admin(db), 'New Person');
  const person = db.approvedPeople().find(p => p.name === 'New Person');
  const registration = db.register(person.name, password);
  db.removePerson(admin(db), person.id, person.name);
  db.addPerson(admin(db), 'Replacement Person');
  const replacement = db.approvedPeople().find(p => p.name === 'Replacement Person');
  assert.equal(replacement.id, person.id);
  await assert.rejects(registration, /no longer on the approved/);
  assert.throws(() => db.removePerson(admin(db), person.id, person.name), /list has changed/);
  assert.equal(db.participants().length, 0);
  assert.equal(db.approvedPeople().some(p => p.name === replacement.name), true);
});

test('failed removal restores account, wishlist, sessions and reset links atomically', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user] = await participants(db, 1);
  const person = db.approvedPeople().find(p => p.name === user.name);
  const session = db.createSession(user.id);
  const reset = db.issuePasswordReset(admin(db), user.id);
  db.saveWishlist(user.id, 'Books');
  db.db.exec("CREATE TRIGGER fail_roster_removal BEFORE DELETE ON approved_people BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  assert.throws(() => db.removePerson(admin(db), person.id, person.name), /test failure/);
  assert.equal(db.user(user.id).wishlist, 'Books');
  assert.equal(db.session(session).id, user.id);
  assert.equal(db.resetLinkInfo(reset).name, user.name);
  assert.equal(db.approvedPeople().some(p => p.id === person.id), true);
});

test('only admin can enable, participants cannot draw early, and admin cannot participate', async t => {
  const db = create(); t.after(() => db.db.close());
  assert.throws(() => db.enableDraw(admin(db)), /At least two/);
  const [person] = await participants(db, 2);
  assert.throws(() => db.enableDraw(person.id), /Only the administrator/);
  assert.throws(() => db.enableDraw('forged-id'), /Only the administrator/);
  assert.throws(() => db.reveal(person.id), /not enabled/);
  assert.throws(() => db.reveal(admin(db)), /Only participants/);
  assert.throws(() => db.saveWishlist(admin(db), 'Admin wishlist'), /Only participants/);
  db.enableDraw(admin(db));
  assert.throws(() => db.reveal(admin(db)), /Only participants/);
  const rows = db.db.prepare('SELECT * FROM assignments').all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.giver !== r.recipient && r.giver !== admin(db) && r.recipient !== admin(db)));
});

test('a complete draw has unique recipients, no self matches, stable reveals, and locked wishlists', async t => {
  const db = create(); t.after(() => db.db.close());
  const users = await participants(db, 7);
  users.forEach(user => db.saveWishlist(user.id, 'Coffee beans\nhttps://example.test/gift'));
  assert.throws(() => db.saveWishlist(users[0].id, 'x'.repeat(5001)), /5,000/);
  db.enableDraw(admin(db));
  const matches = users.map(u => db.reveal(u.id));
  assert.equal(Object.getPrototypeOf(matches[0]), Object.prototype);
  assert.equal(new Set(matches.map(m => m.name)).size, users.length);
  users.forEach((u, i) => {
    assert.notEqual(matches[i].name, u.name);
    assert.deepEqual(db.reveal(u.id), matches[i]);
    assert.deepEqual(Object.keys(matches[i]).sort(), ['name', 'wishlist']);
  });
  const recipient = users.find(u => u.name === matches[0].name);
  for (const value of ['Changed gift', '']) {
    assert.throws(() => db.saveWishlist(recipient.id, value), /Wishlists are locked/);
    assert.equal(db.user(recipient.id).wishlist, 'Coffee beans\nhttps://example.test/gift');
    assert.deepEqual(db.reveal(users[0].id), matches[0]);
  }
  assert.throws(() => db.enableDraw(admin(db)), /already enabled/);
  assert.throws(() => db.reveal('other-user'), /Only participants/);
  await assert.rejects(enroll(db,'Late', password), /closed/);
});

test('registration racing an enabled draw is rejected after hashing', async t => {
  const db = create(); t.after(() => db.db.close());
  await participants(db, 2);
  const registration = enroll(db,roster[20], password);
  db.enableDraw(admin(db));
  await assert.rejects(registration, /closed/);
  assert.equal(db.participants().length, 2);
});

test('failed assignment rolls back all matches and leaves registration open', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user] = await participants(db, 3);
  db.db.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON assignments
    WHEN (SELECT count(*) FROM assignments) = 1 BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
  assert.throws(() => db.enableDraw(admin(db)), /test failure/);
  assert.equal(db.enabled(), false);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM assignments').get().n, 0);
  db.saveWishlist(user.id, 'Still editable after a failed draw');
  assert.equal(db.user(user.id).wishlist, 'Still editable after a failed draw');
  db.db.exec('DROP TRIGGER fail_second');
  db.enableDraw(admin(db));
  assert.equal(db.enabled(), true);
});

test('sessions are opaque, hashed, expire, and are revoked on logout', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user] = await participants(db, 1);
  const token = db.createSession(user.id);
  assert.equal(db.session(token).id, user.id);
  assert.equal(db.session(user.id), undefined);
  assert.equal(db.session('forged'), undefined);
  assert.notEqual(db.db.prepare('SELECT token_hash FROM sessions').get().token_hash, token);
  db.logout(token);
  assert.equal(db.session(token), undefined);
  const expired = db.createSession(user.id);
  db.db.prepare('UPDATE sessions SET expires = 0').run();
  assert.equal(db.session(expired), undefined);
});

test('accounts, sessions, wishlists, and matches survive reopening the local database', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'santa-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'santa.sqlite');
  const first = new SantaStore(filename, adminName, adminPassword, roster);
  const [user] = await participants(first, 3);
  first.saveWishlist(user.id, 'Books');
  first.enableDraw(admin(first));
  const match = first.reveal(user.id);
  const token = first.createSession(user.id);
  first.db.close();
  const second = new SantaStore(filename, adminName, adminPassword, roster);
  t.after(() => second.db.close());
  assert.equal((await second.login(user.name, password)).wishlist, 'Books');
  assert.equal(second.session(token).id, user.id);
  assert.deepEqual(second.reveal(user.id), match);
  assert.equal(second.participants().length, 3);
});

test('changing the configured admin password revokes existing admin sessions', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'santa-admin-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'santa.sqlite');
  const first = new SantaStore(filename, adminName, adminPassword, roster);
  const token = first.createSession(admin(first));
  first.db.close();
  const second = new SantaStore(filename, adminName, 'new-admin-password', roster);
  t.after(() => second.db.close());
  assert.equal(second.session(token), undefined);
  await assert.rejects(second.login(adminName, adminPassword), /Incorrect/);
  assert.equal((await second.login(adminName, 'new-admin-password')).admin, true);
});

test('login attempts are throttled and reset after the cooldown', async t => {
  const db = create(); t.after(() => db.db.close());
  for (let i = 0; i < 10; i++) db.throttle('test');
  assert.throws(() => db.throttle('test'), /Too many/);
  db.db.prepare('UPDATE attempts SET reset = 0').run();
  assert.doesNotThrow(() => db.throttle('test'));
});

test('competing processes cannot redraw or create partial assignments', async t => {
  const { fork } = await import('node:child_process');
  const { once } = await import('node:events');
  const dir = mkdtempSync(join(tmpdir(), 'santa-race-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'santa.sqlite');
  const db = new SantaStore(filename, adminName, adminPassword, roster);
  t.after(() => db.db.close());
  await participants(db, 4);
  const workers = [0, 1].map(() => fork(new URL('./helpers/draw-worker.mjs', import.meta.url), [filename], { silent: true }));
  t.after(() => workers.forEach(worker => { if (worker.connected) worker.kill(); }));
  await Promise.all(workers.map(worker => once(worker, 'message')));
  const results = workers.map(worker => once(worker, 'message'));
  const exits = workers.map(worker => once(worker, 'exit'));
  workers.forEach(worker => worker.send('draw'));
  const outcomes = (await Promise.all(results)).map(([result]) => result);
  await Promise.all(exits);
  assert.equal(outcomes.filter(result => result.success).length, 1);
  assert.equal(outcomes.filter(result => /already enabled/.test(result.error)).length, 1);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM assignments').get().n, 4);
  assert.equal(db.enabled(), true);
});

test('approved roster is seeded, case insensitive, canonical, and unique', async t => {
  const db = create(); t.after(() => db.db.close());
  assert.equal(db.approvedPeople().length, 26);
  assert.deepEqual(db.approvedPeople().map(p => p.name), [...roster].sort());
  await assert.rejects(enroll(db,'Unlisted Person', password), /not on the approved/);
  const user = await enroll(db,'  Test   Participant   12  ', password);
  assert.equal(user.name, 'Test Participant 12');
  await assert.rejects(enroll(db,'TEST PARTICIPANT 12', password), /participant already exists/);
  assert.equal(db.participants().length, 1);
  assert.throws(() => db.db.prepare('INSERT INTO users(id,name_key,name,password_hash) VALUES(?,?,?,?)').run('bypass', 'bypass', 'Unlisted', 'hash'), /approved participant/);
});

test('simultaneous registrations with one approved name in different cases create only one account', async t => {
  const db = create(); t.after(() => db.db.close());
  const results = await Promise.allSettled([
    enroll(db,'Test Participant 01', password),
    enroll(db,'TEST PARTICIPANT 01', password),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(db.participants().length, 1);
});

test('recovery reset verifies the answer, revokes sessions, and preserves account and draw', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user, other] = await participants(db, 2);
  db.saveWishlist(user.id, 'Books');
  db.enableDraw(admin(db));
  const match = db.reveal(user.id);
  const session = db.createSession(user.id);
  const secondSession = db.createSession(user.id);
  const otherSession = db.createSession(other.id);
  await assert.rejects(db.resetPassword(user.name, 'school', 'incorrect answer', 'new-password-123'), /recovery question, or answer is incorrect/);
  assert.equal(db.session(session).id, user.id);
  await assert.rejects(db.resetPassword(user.name, 'school', 'Maple School', 'short'), /at least 8/);
  await assert.rejects(db.resetPassword(user.name, 'school', 'Maple School', '😀'.repeat(19)), /72 UTF-8 bytes/);
  await assert.rejects(db.resetPassword(adminName, 'school', 'Maple School', 'new-password-123'), /recovery question, or answer is incorrect/);
  await db.resetPassword(user.name.toUpperCase(), 'school', '  MAPLE   school  ', 'new-password-123');
  assert.equal(db.session(session), undefined);
  assert.equal(db.session(secondSession), undefined);
  assert.equal(db.session(otherSession).id, other.id);
  await assert.rejects(db.login(user.name, password), /Incorrect/);
  assert.equal((await db.login(user.name, 'new-password-123')).id, user.id);
  assert.equal(db.user(user.id).wishlist, 'Books');
  assert.deepEqual(db.reveal(user.id), match);
  const hash = db.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id).password_hash;
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.equal(await bcrypt.compare('new-password-123', hash), true);
});

test('concurrent recovery resets cannot overwrite a newer password using stale verification', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user] = await participants(db, 1);
  const results = await Promise.allSettled([
    db.resetPassword(user.name, 'school', 'Maple School', 'new-password-one'),
    db.resetPassword(user.name, 'school', 'Maple School', 'new-password-two'),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

test('migration preserves legacy accounts and matches while requiring explicit roster review', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'santa-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'santa.sqlite');
  const first = new SantaStore(filename, adminName, adminPassword, roster);
  const [user, other] = await participants(first, 2);
  first.enableDraw(admin(first));
  const assignments = first.db.prepare('SELECT * FROM assignments ORDER BY giver').all();
  first.db.exec('DROP TRIGGER approved_name_update');
  first.db.prepare("UPDATE users SET name = ?, approved_person_id = NULL WHERE id = ?").run('Legacy nickname', user.id);
  first.db.close();
  const db = new SantaStore(filename, adminName, adminPassword, roster);
  t.after(() => db.db.close());
  assert.equal(db.needsRosterReview(), true);
  assert.equal(db.approvedPeople().length, 26);
  assert.throws(() => db.linkParticipant(other.id, user.id, 1), /Only the administrator/);
  const person = db.approvedPeople().find(p => p.name === roster[0]);
  db.linkParticipant(admin(db), user.id, person.id);
  assert.equal(db.needsRosterReview(), false);
  assert.equal(db.user(user.id).name, roster[0]);
  assert.deepEqual(db.db.prepare('SELECT * FROM assignments ORDER BY giver').all(), assignments);
  assert.equal(db.enabled(), true);
  assert.equal((await db.login(user.name, password)).id, user.id);
});

test('unmatched legacy accounts block signup and cannot claim an already registered person', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user, other] = await participants(db, 2);
  db.db.exec('DROP TRIGGER approved_name_update');
  db.db.prepare('UPDATE users SET approved_person_id = NULL, name = ? WHERE id = ?').run('Legacy name', user.id);
  assert.equal(db.needsRosterReview(), true);
  await assert.rejects(enroll(db,roster[2], password), /match existing accounts/);
  assert.throws(() => db.enableDraw(admin(db)), /Match all existing/);
  const claimed = db.approvedPeople().find(p => p.name === other.name);
  assert.throws(() => db.linkParticipant(admin(db), user.id, claimed.id), /already has an account/);
});

test('migration removes stored email addresses and preserves existing accounts, passwords, sessions, and matches', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const { createHash } = await import('node:crypto');
  const dir = mkdtempSync(join(tmpdir(), 'santa-name-login-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'santa.sqlite');
  const legacy = new DatabaseSync(filename);
  legacy.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE approved_people(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
    CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, wishlist TEXT NOT NULL DEFAULT '',
      approved_person_id INTEGER REFERENCES approved_people(id));
    CREATE TABLE assignments(giver TEXT PRIMARY KEY REFERENCES users(id), recipient TEXT NOT NULL UNIQUE REFERENCES users(id));
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE exchange(id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE attempts(key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL);
    INSERT INTO attempts VALUES('email:old-a@example.test',1,9999999999999);
    INSERT INTO exchange VALUES(1,1);
    CREATE TRIGGER participant_assignment BEFORE INSERT ON assignments
      WHEN (SELECT admin FROM users WHERE id = NEW.giver) = 1
      BEGIN SELECT RAISE(ABORT, 'Admin cannot participate'); END;`);
  const insert = legacy.prepare('INSERT INTO users(id,email,name,password_hash,admin,wishlist) VALUES(?,?,?,?,?,?)');
  insert.run('legacy-admin', 'old-admin@example.test', 'Administrator', bcrypt.hashSync(adminPassword, 12), 1, '');
  const hash = bcrypt.hashSync(password, 12);
  insert.run('legacy-a', 'old-a@example.test', roster[0], hash, 0, 'Books');
  insert.run('legacy-b', 'old-b@example.test', roster[1], hash, 0, 'Coffee');
  legacy.exec("INSERT INTO assignments VALUES('legacy-a','legacy-b'),('legacy-b','legacy-a')");
  const token = 'legacy-session-token';
  legacy.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'), 'legacy-a', Date.now() + 60_000);
  legacy.close();
  const db = new SantaStore(filename, adminName, adminPassword, roster);
  t.after(() => db.db.close());
  assert.equal(db.db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'email'), false);
  assert.equal((await db.login(roster[0].toUpperCase(), password)).id, 'legacy-a');
  assert.equal((await db.login('ADMIN', adminPassword)).admin, true);
  assert.equal(db.user('legacy-a').wishlist, 'Books');
  assert.equal(db.session(token).id, 'legacy-a');
  assert.deepEqual(db.reveal('legacy-a'), { name: roster[1], wishlist: 'Coffee' });
  assert.equal(db.enabled(), true);
  assert.equal(db.needsRosterReview(), false);
  assert.equal(db.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM attempts WHERE key LIKE 'email:%'").get().n, 0);
});

test('optional recovery details must be complete when provided and the answer is hashed', async t => {
  const db = create(); t.after(() => db.db.close());
  await assert.rejects(db.register(roster[0], password, '', 'secret answer'), /Choose a recovery question/);
  await assert.rejects(db.register(roster[0], password, 'toString', 'secret answer'), /Choose a recovery question/);
  await assert.rejects(db.register(roster[0], password, 'school', '  '), /at least 2/);
  await assert.rejects(db.register(roster[0], password, 'school', '😀'.repeat(19)), /72 UTF-8 bytes/);
  const user = await db.register(roster[0], password, 'school', '  MAPLE   School ');
  const stored = db.db.prepare('SELECT recovery_question,recovery_answer_hash FROM users WHERE id = ?').get(user.id);
  assert.equal(stored.recovery_question, 'school');
  assert.match(stored.recovery_answer_hash, /^\$2[aby]\$12\$/);
  assert.equal(await bcrypt.compare('maple school', stored.recovery_answer_hash), true);
  assert.equal('recovery_answer_hash' in user, false);
  assert.equal('recovery_question' in user, false);
  assert.equal(db.hasRecovery(user.id), true);
});

test('wrong questions, unknown users, and incorrect answers cannot reset a password', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user] = await participants(db, 1);
  for (const [name, question, answer] of [[user.name, 'book', 'Maple School'], ['Unknown Person', 'school', 'Maple School'], [user.name, 'school', 'wrong answer']]) {
    await assert.rejects(db.resetPassword(name, question, answer, 'new-password-123'), /recovery question, or answer is incorrect/);
  }
  assert.equal((await db.login(user.name, password)).id, user.id);
  db.db.prepare('UPDATE attempts SET count = 10 WHERE key = ?').run('recovery-reset:' + user.name.toLowerCase());
  await assert.rejects(db.resetPassword(user.name.toUpperCase(), 'school', 'Maple School', 'new-password-123'), /Too many attempts/);
});

test('every recovery question offered by the form supports signup and password reset', async t => {
  const { default: questions } = await import('../lib/recovery-questions.json', { with: { type: 'json' } });
  const db = create(); t.after(() => db.db.close());
  let index = 0;
  for (const question of Object.keys(questions)) {
    const user = await db.register(roster[index++], password, question, 'Example Answer');
    assert.equal(db.db.prepare('SELECT recovery_question FROM users WHERE id = ?').get(user.id).recovery_question, question);
    await db.resetPassword(user.name, question, ' example ANSWER ', 'replacement-password');
    assert.equal((await db.login(user.name, 'replacement-password')).id, user.id);
  }
});


test('registration can skip recovery details without enabling hint-based resets', async t => {
  const db = create(); t.after(() => db.db.close());
  const first = await db.register(roster[0], password);
  const second = await db.register(roster[1], password, '', '   ');
  for (const user of [first, second]) {
    assert.equal(db.hasRecovery(user.id), false);
    const row = db.db.prepare('SELECT recovery_question,recovery_answer_hash FROM users WHERE id = ?').get(user.id);
    assert.equal(row.recovery_question, null);
    assert.equal(row.recovery_answer_hash, null);
    assert.equal((await db.login(user.name, password)).id, user.id);
    await assert.rejects(db.resetPassword(user.name, 'game', 'Cricket', 'replacement-password'), /has not been set up/);
  }
  await assert.rejects(db.register(roster[2], password, 'game', ''), /at least 2/);
  await assert.rejects(db.register(roster[2], password, '', 'Cricket'), /Choose a recovery question/);

});

test('admin issues a private link without changing the account; successful reset revokes target sessions only', async t => {
  const db = create(); t.after(() => db.db.close());
  const user = await db.register(roster[0], password);
  const other = await enroll(db, roster[1], password);
  db.saveWishlist(user.id, 'Books'); db.enableDraw(admin(db));
  const match = db.reveal(user.id);
  const sessions = [db.createSession(user.id), db.createSession(user.id)];
  const otherSession = db.createSession(other.id), adminSession = db.createSession(admin(db));
  const token = db.issuePasswordReset(admin(db), user.id);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const stored = db.db.prepare('SELECT * FROM password_resets WHERE user_id = ?').get(user.id);
  assert.notEqual(stored.token_hash, token); assert.match(stored.token_hash, /^[0-9a-f]{64}$/);
  assert.equal(stored.expires > Date.now() + 29 * 60_000, true);
  assert.equal(stored.expires <= Date.now() + 30 * 60_000, true);
  for (let i = 0; i < 3; i++) assert.equal(db.resetLinkInfo(token).name, user.name);
  assert.equal(db.session(sessions[0]).id, user.id);
  assert.equal((await db.login(user.name, password)).id, user.id);
  await assert.rejects(db.completePasswordReset(token, 'short'), /at least 8/);
  await assert.rejects(db.completePasswordReset(token, '😀'.repeat(19)), /72 UTF-8 bytes/);
  assert.equal(db.resetLinkInfo(token).name, user.name);
  await db.completePasswordReset(token, 'participant-chosen-password');
  assert.equal(db.resetLinkInfo(token), undefined);
  await assert.rejects(db.completePasswordReset(token, 'another-password-123'), /already been used or has expired/);
  for (const session of sessions) assert.equal(db.session(session), undefined);
  assert.equal(db.session(otherSession).id, other.id); assert.equal(db.session(adminSession).admin, true);
  await assert.rejects(db.login(user.name, password), /Incorrect/);
  assert.equal((await db.login(user.name, 'participant-chosen-password')).id, user.id);
  assert.equal(db.user(user.id).wishlist, 'Books'); assert.equal(db.hasRecovery(user.id), false);
  assert.deepEqual(db.reveal(user.id), match);
  const hash = db.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id).password_hash;
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.equal(await bcrypt.compare('participant-chosen-password', hash), true);
});

test('only admin can generate links and links cannot target the admin or missing accounts', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user, other] = await participants(db, 2);
  assert.throws(() => db.issuePasswordReset(other.id, user.id), /Only the administrator/);
  assert.throws(() => db.issuePasswordReset('forged-admin', user.id), /Only the administrator/);
  assert.throws(() => db.issuePasswordReset(admin(db), 'missing-user'), /Choose a participant/);
  assert.throws(() => db.issuePasswordReset(admin(db), admin(db)), /Choose a participant/);
  assert.equal(db.resetLinkInfo('forged-token'), undefined);
  assert.equal(db.resetLinkInfo('A'.repeat(43)), undefined);
  await assert.rejects(db.completePasswordReset('A'.repeat(43), 'new-password-123'), /already been used or has expired/);
  assert.equal((await db.login(user.name, password)).id, user.id);
});

test('expired and replaced links are rejected while other participants links remain valid', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user, other] = await participants(db, 2);
  const expired = db.issuePasswordReset(admin(db), user.id);
  db.db.prepare('UPDATE password_resets SET expires = 0 WHERE user_id = ?').run(user.id);
  assert.equal(db.resetLinkInfo(expired), undefined);
  await assert.rejects(db.completePasswordReset(expired, 'new-password-123'), /already been used or has expired/);
  const first = db.issuePasswordReset(admin(db), user.id);
  const otherLink = db.issuePasswordReset(admin(db), other.id);
  const replacement = db.issuePasswordReset(admin(db), user.id);
  assert.notEqual(replacement, first); assert.equal(db.resetLinkInfo(first), undefined);
  await assert.rejects(db.completePasswordReset(first, 'new-password-123'), /already been used or has expired/);
  assert.equal(db.resetLinkInfo(otherLink).name, other.name);
  await db.completePasswordReset(replacement, 'new-password-123');
  assert.equal(db.resetLinkInfo(otherLink).name, other.name);
});

test('a failed database write rolls back without consuming the reset link', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user] = await participants(db, 1);
  const token = db.issuePasswordReset(admin(db), user.id);
  db.db.exec("CREATE TRIGGER fail_reset BEFORE UPDATE OF password_hash ON users BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  await assert.rejects(db.completePasswordReset(token, 'new-password-123'), /test failure/);
  assert.equal(db.resetLinkInfo(token).name, user.name);
  assert.equal((await db.login(user.name, password)).id, user.id);
  db.db.exec('DROP TRIGGER fail_reset');
  await db.completePasswordReset(token, 'new-password-123');
  assert.equal(db.resetLinkInfo(token), undefined);
});

test('concurrent attempts consume a link only once and recheck expiry after hashing', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user] = await participants(db, 1);
  const token = db.issuePasswordReset(admin(db), user.id);
  const results = await Promise.allSettled([
    db.completePasswordReset(token, 'new-password-one'), db.completePasswordReset(token, 'new-password-two'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const expiring = db.issuePasswordReset(admin(db), user.id);
  const pending = db.completePasswordReset(expiring, 'new-password-three');
  db.db.prepare('UPDATE password_resets SET expires = 0 WHERE user_id = ?').run(user.id);
  await assert.rejects(pending, /already been used or has expired/);
});

test('a recovery-question reset invalidates outstanding admin-issued links', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user] = await participants(db, 1);
  const token = db.issuePasswordReset(admin(db), user.id);
  const recovery = db.db.prepare('SELECT recovery_question,recovery_answer_hash FROM users WHERE id = ?').get(user.id);
  await db.resetPassword(user.name, 'school', 'Maple School', 'new-password-123');
  assert.equal(db.resetLinkInfo(token), undefined);
  assert.deepEqual(db.db.prepare('SELECT recovery_question,recovery_answer_hash FROM users WHERE id = ?').get(user.id), recovery);
});

test('reset links use a configured origin and put the secret in the fragment', async () => {
  const { buildPasswordResetLink } = await import('../lib/reset-url.ts');
  const url = new URL(buildPasswordResetLink('example-token', { NODE_ENV: 'production', APP_URL: 'https://santa.example.test' }));
  assert.equal(url.origin, 'https://santa.example.test'); assert.equal(url.pathname, '/reset-password');
  assert.equal(url.search, ''); assert.equal(url.hash, '#token=example-token');
  assert.throws(() => buildPasswordResetLink('token', { NODE_ENV: 'production' }), /Set APP_URL/);
  for (const APP_URL of ['http://santa.example.test', 'https://user:pass@santa.example.test', 'https://santa.example.test/path', 'https://santa.example.test?token=bad'])
    assert.throws(() => buildPasswordResetLink('token', { NODE_ENV: 'production', APP_URL }));
  assert.match(buildPasswordResetLink('token', { NODE_ENV: 'production', APP_URL: 'http://127.0.0.1:3002' }), /^http:\/\/127.0.0.1:3002\/reset-password#/);
});

test('successful login clears prior failed attempts for the same normalized account name', async t => {
  const db = create(); t.after(() => db.db.close());
  const [user] = await participants(db, 1);
  const key = 'name:' + user.name.toLowerCase();
  db.db.prepare('INSERT INTO attempts VALUES(?,?,?)').run(key, 9, Date.now() + 15 * 60_000);
  assert.equal((await db.login(user.name.toUpperCase(), password)).id, user.id);
  assert.equal(db.db.prepare('SELECT 1 FROM attempts WHERE key = ?').get(key), undefined);
  await assert.rejects(db.login(user.name, 'incorrect-password'), /Incorrect/);
  assert.equal(db.db.prepare('SELECT count FROM attempts WHERE key = ?').get(key).count, 1);
});

test('network rate limits can allow team activity while account-specific counters remain independent', t => {
  const db = create(); t.after(() => db.db.close());
  for (let i = 0; i < 20; i++) db.throttle('network', 200);
  for (let i = 0; i < 10; i++) db.throttle('account-a');
  assert.throws(() => db.throttle('account-a'), /Too many attempts/);
  assert.doesNotThrow(() => db.throttle('account-b'));
  db.clearThrottle('account-a');
  assert.doesNotThrow(() => db.throttle('account-a'));
});

test('sign-in identifies unapproved names, unregistered approved people, and incorrect passwords', async t => {
  const db = create(); t.after(() => db.db.close());
  await assert.rejects(db.login('Unlisted Person', password), { message: 'Name not recognized. Enter your full name as shown in your Aria Profile.' });
  await assert.rejects(db.login('  TEST   PARTICIPANT   23  ', password), { message: 'No account exists for this name. Please create an account.' });
  const user = await db.register('Test Participant 23', password);
  await assert.rejects(db.login(user.name, 'incorrect-password'), { message: 'Incorrect password. Try again or reset your password.' });
  assert.equal((await db.login('TEST PARTICIPANT 23', password)).id, user.id);
  await assert.rejects(db.login(adminName, 'incorrect-password'), { message: 'Incorrect password. Try again or reset your password.' });
  assert.equal((await db.login(adminName, adminPassword)).admin, true);
});
