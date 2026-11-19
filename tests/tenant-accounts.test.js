import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
const { createDb, createApp } = await import('../server.js');

test('tenant accounts and favorites persist and are isolated between tenants', async () => {
  const db = createDb(':memory:');
  try {
    const app = createApp(db);
    const alice = request.agent(app);
    const bob = request.agent(app);
    const password = 'secure test password';
    const register = (client, email) => client.post('/api/account/register').send({ email, password });

    assert.equal((await alice.get('/api/account')).status, 401);
    const registration = await register(alice, 'Alice@example.test');
    assert.equal(registration.status, 201);
    assert.equal(registration.body.email, 'alice@example.test');
    assert.match(registration.headers['set-cookie'][0], /HttpOnly; SameSite=Lax/i);
    assert.equal((await register(bob, 'bob@example.test')).status, 201);
    assert.equal((await alice.put('/api/account/favorites/1')).status, 204);
    assert.deepEqual((await alice.get('/api/account/favorites')).body, [1]);
    assert.deepEqual((await bob.get('/api/account/favorites')).body, []);
    assert.equal((await alice.post('/api/account/logout')).status, 204);
    assert.equal((await alice.get('/api/account/favorites')).status, 401);

    const anotherDevice = request.agent(createApp(db));
    assert.equal((await anotherDevice.post('/api/account/login').send({
      email: 'alice@example.test', password: 'incorrect passphrase',
    })).status, 401);
    assert.equal((await anotherDevice.post('/api/account/login').send({
      email: 'ALICE@example.test', password,
    })).status, 200);
    assert.deepEqual((await anotherDevice.get('/api/account/favorites')).body, [1]);
    assert.equal((await anotherDevice.delete('/api/account/favorites/1')).status, 204);
    assert.deepEqual((await anotherDevice.get('/api/account/favorites')).body, []);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM tenant_accounts').all()).includes(password));
  } finally { db.close(); }
});
