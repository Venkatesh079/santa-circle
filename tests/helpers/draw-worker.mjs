import { SantaStore } from '../../lib/store.ts';
const db = new SantaStore(process.argv[2], 'admin', 'admin-test-password');
process.send('ready');
process.once('message', () => {
  try {
    const admin = db.db.prepare('SELECT id FROM users WHERE admin = 1').get();
    db.enableDraw(admin.id);
    process.send({ success: true });
  } catch (error) {
    process.send({ error: error.message });
  } finally {
    db.db.close();
    process.disconnect();
  }
});
