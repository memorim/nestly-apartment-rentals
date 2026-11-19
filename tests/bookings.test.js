import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { testPayments } from '../yookassa-test.js';

process.env.NODE_ENV = 'test';
const { createApp, createDb } = await import('../server.js');

test('YooKassa configuration rejects a live key', () => {
  assert.throws(() => testPayments({
    shopId: '123456', testKey: 'live_live-key', origin: 'https://nestly.example',
  }));
});

test('only a verified YooKassa test payment can confirm a conflict-free booking', async () => {
  const db = createDb(':memory:');
  let time = Date.parse('2031-01-01T00:00:00Z');
  const payments = new Map();
  let captures = 0;
  const provider = {
    async create(booking) {
      const id = randomUUID();
      const payment = {
        id, test: true, status: 'pending', metadata: { booking_id: booking.id },
        amount: { currency: 'RUB', value: booking.amount_rub.toFixed(2) },
        confirmation: { confirmation_url: 'https://yoomoney.ru/test-checkout' },
      };
      payments.set(id, payment);
      return payment;
    },
    async get(id) { return payments.get(id); },
    async capture(id) {
      captures++;
      const payment = payments.get(id);
      payment.status = 'succeeded';
      return payment;
    },
    async cancel(id) {
      const payment = payments.get(id);
      payment.status = 'canceled';
      return payment;
    },
  };
  try {
    const app = createApp(db, { now: () => time, paymentProvider: provider });
    const alice = request.agent(app), bob = request.agent(app);
    for (const [client, email] of [[alice, 'a@example.test'], [bob, 'b@example.test']])
      assert.equal((await client.post('/api/account/register').send({ email, password: 'secret regression test' })).status, 201);
    const book = (client, startDate = '2031-01-31') =>
      client.post('/api/account/bookings').send({ listingId: 1, startDate });
    const first = await book(alice);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.end_date, '2031-02-28');
    assert.equal(first.body.amount_rub, 145000);
    assert.equal((await book(alice)).body.id, first.body.id);
    assert.equal((await book(bob)).status, 409);
    const verify = client => client.post('/api/account/bookings/' + first.body.id + '/verify');
    assert.equal((await verify(bob)).status, 404);

    const payment = [...payments.values()][0];
    payment.status = 'waiting_for_capture';
    payment.test = false;
    assert.equal((await verify(alice)).status, 503);
    assert.equal(captures, 0);
    payment.test = true;
    const webhook = await request(app).post('/api/payments/yookassa').send({ object: { id: payment.id } });
    assert.equal(webhook.status, 204);
    assert.equal(captures, 1);
    assert.equal((await verify(alice)).body.status, 'confirmed');
    assert.equal((await request(app).get('/api/listings/1/availability')).body[0].end_date, '2031-02-28');

    const later = await book(bob, '2031-03-01');
    assert.equal(later.status, 201);
    const latePayment = [...payments.values()][1];
    latePayment.status = 'waiting_for_capture';
    time += 31 * 60 * 1000;
    const late = await bob.post('/api/account/bookings/' + later.body.id + '/verify');
    assert.equal(late.body.status, 'canceled');
    assert.equal(captures, 1);
  } finally { db.close(); }
});
