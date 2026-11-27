import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SantaStore } from '../lib/store.ts';
import { testRoster as roster } from './helpers/roster.mjs';

const adminPassword = 'admin-test-password';
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'santa-protected-reset-'));
  const db = new SantaStore(join(directory, 'santa.sqlite'), 'admin', adminPassword, roster);
  t.after(() => { db.db.close(); rmSync(directory, { recursive: true, force: true }); });
  const users = await Promise.all(roster.slice(0, 2).map(name => db.register(name, 'participant-password', 'game', 'Chess')));
  db.saveWishlist(users[0].id, 'Books');
  const adminId = db.db.prepare('SELECT id FROM users WHERE admin=1').get().id;
  const session = db.createSession(adminId);
  db.enableDraw(adminId);
  const input = { password: adminPassword, reason: 'A participant needs to leave the event.', understood: true, notified: true, sessionToken: session, revision: db.drawRevision() };
  const assignments = () => db.db.prepare('SELECT * FROM assignments ORDER BY giver').all();
  return { db, directory, users, adminId, session, input, assignments };
}

test('protected draw reset requires admin session, acknowledgements, reason, current draw and correct password', async t => {
  const { db, users, adminId, session, input, assignments } = await fixture(t);
  const before = assignments();
  await assert.rejects(db.prepareDrawReset(users[0].id, { ...input, sessionToken: db.createSession(users[0].id) }), /Only the signed-in administrator/);
  await assert.rejects(db.prepareDrawReset('forged-id', input), /Only the signed-in administrator/);
  for (const changes of [{ sessionToken: 'missing' }, { understood: false }, { notified: false }, { reason: 'short' }, { reason: 'x'.repeat(501) }, { revision: input.revision - 1 }, { password: 'incorrect-password' }])
    await assert.rejects(db.prepareDrawReset(adminId, { ...input, ...changes }));
  await assert.rejects(db.resetDraw(adminId, session, 'x'.repeat(43), 'RESET DRAW', true), /approval/i);
  assert.deepEqual(assignments(), before);
  assert.equal(db.enabled(), true);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM draw_reset_requests').get().n, 0);
});

test('protected draw reset backs up first, preserves accounts and records reason while reopening setup', async t => {
  const { db, users, adminId, session, input, assignments } = await fixture(t);
  const userSession = db.createSession(users[0].id);
  const passwordReset = db.issuePasswordReset(adminId, users[0].id);
  const accounts = db.db.prepare('SELECT * FROM users ORDER BY id').all();
  const before = assignments();
  const approval = await db.prepareDrawReset(adminId, input);
  assert.deepEqual(assignments(), before);
  assert.equal(db.db.prepare('SELECT token_hash FROM draw_reset_requests').get().token_hash.includes(approval.token), false);
  const result = await db.resetDraw(adminId, session, approval.token, 'RESET DRAW', true);
  assert.equal(result.participantCount, 2);
  assert.equal(statSync(result.backupPath).mode & 0o777, 0o600);
  const saved = new DatabaseSync(result.backupPath, { readOnly: true });
  try {
    assert.deepEqual(saved.prepare('SELECT * FROM assignments ORDER BY giver').all(), before);
    assert.equal(saved.prepare('SELECT enabled FROM exchange').get().enabled, 1);
  } finally { saved.close(); }
  assert.equal(db.enabled(), false);
  assert.equal(assignments().length, 0);
  assert.deepEqual(db.db.prepare('SELECT * FROM users ORDER BY id').all(), accounts);
  assert.equal(db.session(userSession).id, users[0].id);
  assert.equal(db.resetLinkInfo(passwordReset).name, users[0].name);
  const history = db.db.prepare('SELECT * FROM draw_reset_history').get();
  assert.equal(history.reason, input.reason);
  assert.equal(history.admin_id, adminId);
  assert.equal(history.revision, input.revision);
  assert.equal(history.participant_count, 2);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM draw_reset_requests').get().n, 0);
  assert.throws(() => db.reveal(users[0].id), /not enabled/);
  db.saveWishlist(users[0].id, 'Coffee');
  db.addPerson(adminId, 'New Person');
  const newPerson = await db.register('New Person', 'participant-password');
  db.enableDraw(adminId);
  assert.equal(assignments().length, 3);
  assert.notEqual(db.reveal(newPerson.id).name, newPerson.name);
  await assert.rejects(db.resetDraw(adminId, session, approval.token, 'RESET DRAW', true), /approval/i);
  assert.equal(db.enabled(), true);
  await assert.rejects(db.prepareDrawReset(adminId, input), /draw changed/i);
});

test('wrong reset phrase or missing final confirmation never consumes approval or clears assignments', async t => {
  const { db, adminId, session, input, assignments } = await fixture(t);
  const before = assignments();
  const approval = await db.prepareDrawReset(adminId, input);
  for (const [phrase, confirm] of [['reset draw', true], ['RESET DRAW ', true], ['RESET DRAW', false]]) {
    await assert.rejects(db.resetDraw(adminId, session, approval.token, phrase, confirm), /Type RESET DRAW exactly/);
    assert.deepEqual(assignments(), before);
  }
  await db.resetDraw(adminId, session, approval.token, 'RESET DRAW', true);
  assert.equal(db.enabled(), false);
});

test('reset approval expires, is replaced by a new approval and is bound to its original session', async t => {
  const { db, adminId, session, input, assignments } = await fixture(t);
  const before = assignments();
  const first = await db.prepareDrawReset(adminId, input);
  db.db.prepare('UPDATE draw_reset_requests SET expires=0').run();
  await assert.rejects(db.resetDraw(adminId, session, first.token, 'RESET DRAW', true), /expired/);
  const second = await db.prepareDrawReset(adminId, input);
  const third = await db.prepareDrawReset(adminId, input);
  await assert.rejects(db.resetDraw(adminId, session, second.token, 'RESET DRAW', true), /approval/i);
  const anotherSession = db.createSession(adminId);
  await assert.rejects(db.resetDraw(adminId, anotherSession, third.token, 'RESET DRAW', true), /approval/i);
  db.logout(session);
  await assert.rejects(db.resetDraw(adminId, session, third.token, 'RESET DRAW', true), /signed-in administrator/);
  assert.deepEqual(assignments(), before);
});

test('backup failure leaves the draw and approval untouched', async t => {
  const { db, directory, adminId, session, input, assignments } = await fixture(t);
  const before = assignments();
  const approval = await db.prepareDrawReset(adminId, input);
  writeFileSync(join(directory, 'backups'), 'block backup directory');
  await assert.rejects(db.resetDraw(adminId, session, approval.token, 'RESET DRAW', true));
  assert.deepEqual(assignments(), before);
  assert.equal(db.enabled(), true);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM draw_reset_history').get().n, 0);
  rmSync(join(directory, 'backups'));
  await db.resetDraw(adminId, session, approval.token, 'RESET DRAW', true);
  assert.equal(db.enabled(), false);
});

test('failed draw reset transaction rolls back assignments, enabled state, approval and history together', async t => {
  const { db, adminId, session, input, assignments } = await fixture(t);
  const before = assignments();
  const approval = await db.prepareDrawReset(adminId, input);
  db.db.exec("CREATE TRIGGER fail_draw_reset BEFORE DELETE ON assignments BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  await assert.rejects(db.resetDraw(adminId, session, approval.token, 'RESET DRAW', true), /test failure/);
  assert.deepEqual(assignments(), before);
  assert.equal(db.enabled(), true);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM draw_reset_history').get().n, 0);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM draw_reset_requests').get().n, 1);
  db.db.exec('DROP TRIGGER fail_draw_reset');
  await db.resetDraw(adminId, session, approval.token, 'RESET DRAW', true);
  assert.equal(db.enabled(), false);
});

test('concurrent final confirmations can reset the draw only once', async t => {
  const { db, adminId, session, input } = await fixture(t);
  const approval = await db.prepareDrawReset(adminId, input);
  const outcomes = await Promise.allSettled([0, 1].map(() => db.resetDraw(adminId, session, approval.token, 'RESET DRAW', true)));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM draw_reset_history').get().n, 1);
  assert.equal(db.enabled(), false);
});

test('administrator password verification for draw reset is rate limited', async t => {
  const { db, adminId, input, assignments } = await fixture(t);
  const before = assignments();
  for (let i = 0; i < 5; i++) await assert.rejects(db.prepareDrawReset(adminId, { ...input, password: 'wrong' }), /Incorrect administrator password/);
  await assert.rejects(db.prepareDrawReset(adminId, input), /Too many attempts/);
  assert.deepEqual(assignments(), before);
});
