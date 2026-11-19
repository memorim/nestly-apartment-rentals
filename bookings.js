import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { writeTransaction } from './postgres.js';
import { tenantAccess } from './tenants.js';
import { testPaymentStatus as paymentStatus } from './yookassa-test.js';
import { consumeBudget } from './request-budget.js';

const holdDuration = 30 * 60 * 1000;
const date = z.iso.date();
const dates = z.object({ listingId: z.number().int().positive(), startDate: date }).strict();
const bookingId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const statusView = 'id,listing_id,start_date,end_date,amount_rub,status,expires_at,payment_url';

export function overlappingBooking(db, listingId, start, end, time) {
  return db.prepare(`SELECT id FROM tenant_bookings WHERE listing_id=? AND start_date<? AND end_date>?
    AND (status IN ('confirmed','capturing') OR (status='pending' AND expires_at>?)) LIMIT 1`)
    .get(listingId, end, start, time);
}

function endOfMonth(start) {
  const [year, month, day] = start.split('-').map(Number);
  const finalDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, finalDay))).toISOString().slice(0, 10);
}

function validPayment(payment, booking) {
  return payment.test === true && bookingId.test(payment.id) &&
    (!booking.payment_id || payment.id === booking.payment_id) &&
    payment.metadata?.booking_id === booking.id &&
    payment.amount?.currency === 'RUB' && payment.amount?.value === booking.amount_rub.toFixed(2);
}

export function bookingRoutes(app, db, { now, provider }) {
  const authenticate = tenantAccess(db, now);
  const byId = id => db.prepare('SELECT * FROM tenant_bookings WHERE id=?').get(id);
  const read = id => db.prepare('SELECT ' + statusView + ' FROM tenant_bookings WHERE id=?').get(id);

  async function updatePayment(booking, payment) {
    if (!validPayment(payment, booking)) throw new Error('Unverified test payment');
    if (payment.status === paymentStatus.authorized) {
      const decision = await writeTransaction(db, async () => {
        const fresh = await byId(booking.id);
        if (fresh.status === 'capturing') return 'capture';
        if (fresh.status === 'confirmed' || fresh.status === 'canceled') return 'skip';
        if (fresh.status !== 'pending' || fresh.expires_at <= now()) return 'cancel';
        await db.prepare("UPDATE tenant_bookings SET status='capturing' WHERE id=?").run(booking.id);
        return 'capture';
      });
      if (decision === 'skip') return read(booking.id);
      payment = decision === 'capture'
        ? await provider.capture(payment.id, booking.id)
        : await provider.cancel(payment.id, booking.id);
      if (!validPayment(payment, booking)) throw new Error('Unverified test payment');
    }
    if (payment.status === paymentStatus.paid) {
      await db.prepare("UPDATE tenant_bookings SET status='confirmed' WHERE id=? AND status='capturing'")
        .run(booking.id);
    }
    if (payment.status === paymentStatus.canceled) {
      await db.prepare("UPDATE tenant_bookings SET status='canceled' WHERE id=? AND status<>'confirmed'")
        .run(booking.id);
    }
    return read(booking.id);
  }

  app.get('/api/account/bookings', authenticate, async (req, res) => {
    const rows = await db.prepare('SELECT ' + statusView + ' FROM tenant_bookings WHERE account_id=? ORDER BY start_date DESC')
      .all(req.tenant.id);
    res.json({ testPayments: Boolean(provider), bookings: rows });
  });

  app.post('/api/account/bookings', authenticate, async (req, res) => {
    if (!provider) return res.status(503).json({ message: 'Настройте тестовый магазин ЮKassa' });
    const parsed = dates.safeParse(req.body);
    const time = now();
    const today = new Date(time).toISOString().slice(0, 10);
    const latest = new Date(time + 365 * 86400000).toISOString().slice(0, 10);
    if (!parsed.success || parsed.data.startDate < today || parsed.data.startDate > latest)
      return res.status(400).json({ message: 'Выберите дату начала аренды в пределах года' });
    const { listingId, startDate } = parsed.data;
    const budget = await consumeBudget(db, 'booking:' + req.tenant.id, 10, time, 10 * 60000);
    if (!budget.allowed) return res.status(429).set('Retry-After', String(budget.retryAfter))
      .json({ message: 'Повторите попытку позже' });
    const endDate = endOfMonth(startDate);
    const result = await writeTransaction(db, async () => {
      const existing = await db.prepare(`SELECT * FROM tenant_bookings
        WHERE account_id=? AND listing_id=? AND start_date=? AND status='pending' AND expires_at>? LIMIT 1`)
        .get(req.tenant.id, listingId, startDate, time);
      if (existing) return { booking: existing, status: 200 };
      const listing = await db.prepare('SELECT price FROM listings WHERE id=? AND available=1').get(listingId);
      if (!listing) return { status: 404, message: 'Квартира недоступна' };
      const occupied = await db.prepare('SELECT id FROM occupancy WHERE listing_id=? AND start_date<? AND end_date>? LIMIT 1')
        .get(listingId, endDate, startDate);
      if (occupied || await overlappingBooking(db, listingId, startDate, endDate, time))
        return { status: 409, message: 'Выбранный месяц уже занят' };
      const id = randomUUID();
      await db.prepare(`INSERT INTO tenant_bookings
        (id,account_id,listing_id,start_date,end_date,amount_rub,status,expires_at)
        VALUES(?,?,?,?,?,?,'pending',?)`).run(id, req.tenant.id, listingId, startDate, endDate, listing.price, time + holdDuration);
      return { booking: await byId(id), status: 201 };
    });
    if (!result.booking) return res.status(result.status).json({ message: result.message });
    const booking = result.booking;
    if (!booking.payment_id) {
      const payment = await provider.create(booking);
      if (!validPayment(payment, booking) || payment.status !== paymentStatus.pending)
        throw new Error('Unexpected test payment');
      const url = new URL(payment.confirmation?.confirmation_url);
      if (url.protocol !== 'https:' || url.username || url.password ||
          !['yoomoney.ru', 'yookassa.ru'].includes(url.hostname))
        throw new Error('Unexpected test confirmation address');
      await db.prepare('UPDATE tenant_bookings SET payment_id=?,payment_url=? WHERE id=? AND payment_id IS NULL')
        .run(payment.id, url.href, booking.id);
    }
    res.status(result.status).json(await read(booking.id));
  });

  app.post('/api/account/bookings/:booking/verify', authenticate, async (req, res) => {
    const id = req.params.booking;
    const booking = bookingId.test(id) && await byId(id);
    if (!booking || booking.account_id !== req.tenant.id)
      return res.status(404).json({ message: 'Бронирование не найдено' });
    if (!provider || !booking.payment_id)
      return res.status(409).json({ message: 'Тестовая оплата ещё не создана' });
    res.json(await updatePayment(booking, await provider.get(booking.payment_id)));
  });

  app.post('/api/payments/yookassa', async (req, res) => {
    const id = req.body?.object?.id;
    if (typeof id !== 'string' || !bookingId.test(id) || !provider) return res.status(204).end();
    const booking = await db.prepare('SELECT * FROM tenant_bookings WHERE payment_id=?').get(id);
    if (booking) await updatePayment(booking, await provider.get(id));
    res.status(204).end();
  });
}
