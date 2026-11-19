import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { purgeContacts } from '../contacts.js';
process.env.NODE_ENV = 'test';
const { createApp, createDb } = await import('../server.js');

test('owner exports and erases contacts while the inquiry remains available', async () => {
  const db = createDb(':memory:');
  const previous = process.env.APP_OWNER_TOKEN;
  process.env.APP_OWNER_TOKEN = 'owner-test-token'.repeat(3);
  try {
    const agent = request(createApp(db));
    const created = await agent.post('/api/inquiries').send({
      listingId: 1, name: '=HYPERLINK()', phone: '+12025550123', message: 'CSV test',
    });
    assert.equal(created.status, 201);
    const authorize = req => req.auth(process.env.APP_OWNER_TOKEN, { type: 'bearer' });
    assert.equal((await agent.get('/api/owner/inquiries.csv')).status, 401);
    const exported = await authorize(agent.get('/api/owner/inquiries.csv'));
    assert.equal(exported.status, 200);
    assert.match(exported.text, /"'=HYPERLINK\(\)"/);
    assert.match(exported.text, /CSV test/);
    assert.equal((await authorize(agent.delete('/api/owner/inquiries/' + created.body.id + '/contacts'))).status, 204);
    assert.deepEqual(await db.prepare('SELECT name,phone,message FROM inquiries WHERE id=?').get(created.body.id),
      Object.assign(Object.create(null), { name: '[removed]', phone: '', message: '' }));

    const oldInquiry = db.prepare('INSERT INTO inquiries(listing_id,name,phone,message,created_at) VALUES(1,?,?,?,?)');
    const row = oldInquiry.run('Old Viewer', '+12025550124', 'Old message', '2021-01-01T00:00:00.000Z');
    assert.equal(purgeContacts(db, Date.now(), 0), undefined);
    assert.equal(purgeContacts(db, Date.now(), 30).changes, 1);
    assert.equal(db.prepare('SELECT phone FROM inquiries WHERE id=?').get(row.lastInsertRowid).phone, '');
  } finally {
    db.close();
    if (previous === undefined) delete process.env.APP_OWNER_TOKEN;
    else process.env.APP_OWNER_TOKEN = previous;
  }
});
