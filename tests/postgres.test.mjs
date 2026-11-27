import test from 'node:test';
import assert from 'node:assert/strict';

// Run against a disposable database after applying the current santa_app migration.
// This test clears santa_app data. Never point it at a real exchange.
test('PostgreSQL persistence, concurrency, recovery and protected draw reset', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const { Pool } = await import('pg');
  const { PgDatabase } = await import('../lib/postgres.ts');
  const { PostgresStore } = await import('../lib/postgres-store.ts');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5 });
  t.after(() => pool.end());
  const db = new PgDatabase(pool);
  await db.transaction(async () => {
    for (const table of ['draw_reset_requests','draw_reset_history','draw_backups','assignments','sessions','password_resets','attempts','users','approved_people'])
      await db.prepare(`DELETE FROM ${table}`).run();
    await db.prepare('UPDATE exchange SET enabled=0,revision=0').run();
  });
  const first = new PostgresStore(db);
  const second = new PostgresStore(new PgDatabase(pool));
  const password = 'private-admin-password';
  await Promise.all([first.initialize('admin', password),second.initialize('admin',password)]);
  const admin = await first.login('admin',password);
  await assert.rejects(first.addPerson('unknown','Alice'), /Only the administrator/);
  for (const name of ['Alice','Bob','Charlie']) await first.addPerson(admin.id,name);
  const competing = await Promise.allSettled([first.register('Alice','participant-password','school','Maple'),second.register('Alice','participant-password')]);
  assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);
  const alice = competing.find(x=>x.status==='fulfilled').value;
  // Ensure the recovery flow has a known hint even if the other request won.
  const bcrypt = (await import('bcryptjs')).default;
  await db.prepare('UPDATE users SET recovery_question=?,recovery_answer_hash=? WHERE id=?').run('school',await bcrypt.hash('maple',12),alice.id);
  const bob = await first.register('Bob','participant-password');
  const charlie = await second.register('Charlie','participant-password');
  await first.saveWishlist(alice.id,'Books');
  assert.equal((await second.user(alice.id)).wishlist,'Books');
  const session = await first.createSession(alice.id);
  assert.equal((await second.session(session)).id,alice.id);
  const link = await first.issuePasswordReset(admin.id,alice.id);
  assert.equal((await second.resetLinkInfo(link)).name,'Alice');
  await second.completePasswordReset(link,'replacement-password');
  assert.equal(await first.session(session),undefined);
  await assert.rejects(first.completePasswordReset(link,'replacement-password'),/expired/);
  await first.resetPassword('Alice','school','MAPLE','participant-password');
  assert.equal((await second.login('Alice','participant-password')).id,alice.id);
  const draws = await Promise.allSettled([first.enableDraw(admin.id), second.enableDraw(admin.id)]);
  assert.equal(draws.filter(x=>x.status==='fulfilled').length,1);
  const matches = await Promise.all([alice,bob,charlie].map(p=>first.reveal(p.id)));
  assert.equal(new Set(matches.map(p=>p.name)).size,3);
  [alice,bob,charlie].forEach((p,i)=>assert.notEqual(matches[i].name,p.name));
  await assert.rejects(first.saveWishlist(alice.id,'Changed'), /locked/);
  await assert.rejects(second.addPerson(admin.id,'David'), /cannot be changed/);
  const adminSession = await first.createSession(admin.id);
  const approval = await first.prepareDrawReset(admin.id,{password,reason:'Correct the participant roster',understood:true,notified:true,sessionToken:adminSession,revision:await first.drawRevision()});
  const originalMatches = await db.prepare('SELECT * FROM assignments ORDER BY giver').all();
  // A snapshot write failure must roll back the reset, including its audit record.
  const originalPrepare = db.prepare.bind(db);
  db.prepare = sql => {
    if(sql.startsWith('INSERT INTO draw_backups')) throw new Error('simulated archive failure');
    return originalPrepare(sql);
  };
  await assert.rejects(first.resetDraw(admin.id,adminSession,approval.token,'RESET DRAW',true),/simulated archive failure/);
  assert.equal(await second.enabled(),true);
  assert.deepEqual(await originalPrepare('SELECT * FROM assignments ORDER BY giver').all(),originalMatches);
  db.prepare = originalPrepare;
  const resets = await Promise.allSettled([first.resetDraw(admin.id,adminSession,approval.token,'RESET DRAW',true),second.resetDraw(admin.id,adminSession,approval.token,'RESET DRAW',true)]);
  assert.equal(resets.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(await first.enabled(),false);
  const snapshots = await db.prepare('SELECT snapshot FROM draw_backups').all();
  assert.equal(snapshots.length,1);
  assert.equal(snapshots[0].snapshot.assignments.length,3);
  assert.equal((await second.participants()).length,3);
  assert.equal((await second.user(alice.id)).wishlist,'Books');
  await assert.rejects(first.resetDraw(admin.id,adminSession,approval.token,'RESET DRAW',true));
  await first.enableDraw(admin.id);
  await assert.rejects(second.resetDraw(admin.id,adminSession,approval.token,'RESET DRAW',true));
  // Data API roles must not see credentials or private recovery archives.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE anon');
    await assert.rejects(client.query('SELECT * FROM santa_app.users'), /permission denied/);
    await client.query('ROLLBACK');
  } finally { client.release(); }
});
