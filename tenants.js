import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { consumeBudget } from './request-budget.js';
import { writeTransaction } from './postgres.js';

const deriveKey = promisify(scrypt);
const cookieName = 'nestly_session';
const sessionLength = 30 * 24 * 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const credentials = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  password: z.string().min(10).max(128),
}).strict();

function session(req) {
  const token = /(?:^|; *)nestly_session=([a-f0-9]{64})(?:;|$)/.exec(req.get('cookie') || '')?.[1];
  return token && hash(token);
}

export function tenantAccess(db, now) {
  return async (req, res, next) => {
    const token = session(req);
    const account = token && await db.prepare(
      'SELECT a.id,a.email FROM tenant_accounts a JOIN tenant_sessions s ON s.account_id=a.id WHERE s.token_hash=? AND s.expires_at>?',
    ).get(token, now());
    if (!account) return res.status(401).json({ message: 'Войдите в аккаунт арендатора' });
    req.tenant = account;
    next();
  };
}

export function tenantRoutes(app, db, { now, secure }) {
  const cookie = { httpOnly: true, sameSite: 'lax', secure, path: '/' };
  const authenticate = tenantAccess(db, now);
  for (const action of ['register', 'login']) {
    app.post('/api/account/' + action, async (req, res) => {
      const parsed = credentials.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ message: 'Укажите email и пароль от 10 до 128 символов' });
      const { email, password } = parsed.data;
      const time = now();
      const budget = await consumeBudget(db, 'account:' + hash(email), 10, time, 15 * 60000);
      if (!budget.allowed) return res.status(429).set('Retry-After', String(budget.retryAfter))
        .json({ message: 'Повторите попытку позже' });
      const overall = await consumeBudget(db, 'account-auth', 60, time);
      if (!overall.allowed) return res.status(429).set('Retry-After', String(overall.retryAfter))
        .json({ message: 'Повторите попытку позже' });
      let account;
      if (action === 'register') {
        const salt = randomBytes(16);
        const passwordHash = await deriveKey(password, salt, 32);
        account = { id: randomBytes(16).toString('hex'), email };
        const inserted = await db.prepare(
          'INSERT INTO tenant_accounts(id,email,salt,password_hash) VALUES(?,?,?,?) ON CONFLICT(email) DO NOTHING',
        ).run(account.id, email, salt.toString('hex'), passwordHash.toString('hex'));
        if (!inserted.changes) return res.status(409).json({ message: 'Email уже зарегистрирован' });
      } else {
        const found = await db.prepare('SELECT * FROM tenant_accounts WHERE email=?').get(email);
        const key = await deriveKey(password, Buffer.from(found?.salt || '00'.repeat(16), 'hex'), 32);
        const expected = Buffer.from(found?.password_hash || '00'.repeat(32), 'hex');
        if (!timingSafeEqual(key, expected) || !found)
          return res.status(401).json({ message: 'Проверьте email и пароль' });
        account = { id: found.id, email };
      }
      const token = randomBytes(32).toString('hex');
      const previous = session(req);
      await writeTransaction(db, async () => {
        await db.prepare('DELETE FROM tenant_sessions WHERE expires_at<=? OR token_hash=?').run(time, previous ?? '');
        await db.prepare('INSERT INTO tenant_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)')
          .run(hash(token), account.id, time + sessionLength);
      });
      res.cookie(cookieName, token, { ...cookie, maxAge: sessionLength })
        .status(action === 'register' ? 201 : 200).json(account);
    });
  }
  app.post('/api/account/logout', async (req, res) => {
    const token = session(req);
    if (token) await db.prepare('DELETE FROM tenant_sessions WHERE token_hash=?').run(token);
    res.clearCookie(cookieName, cookie).status(204).end();
  });
  app.get('/api/account', authenticate, (req, res) => res.json(req.tenant));
  app.get('/api/account/favorites', authenticate, async (req, res) => {
    const rows = await db.prepare('SELECT listing_id FROM tenant_favorites WHERE account_id=? ORDER BY listing_id')
      .all(req.tenant.id);
    res.json(rows.map(row => row.listing_id));
  });
  app.put('/api/account/favorites/:id', authenticate, async (req, res) => {
    const id = Number(req.params.id);
    if (!(await db.prepare('SELECT id FROM listings WHERE id=? AND available=1').get(id)))
      return res.status(404).json({ message: 'Квартира не найдена' });
    await db.prepare('INSERT INTO tenant_favorites(account_id,listing_id) VALUES(?,?) ON CONFLICT DO NOTHING')
      .run(req.tenant.id, id);
    res.status(204).end();
  });
  app.delete('/api/account/favorites/:id', authenticate, async (req, res) => {
    await db.prepare('DELETE FROM tenant_favorites WHERE account_id=? AND listing_id=?').run(req.tenant.id, Number(req.params.id));
    res.status(204).end();
  });
}
