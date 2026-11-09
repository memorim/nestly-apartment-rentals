// Fixed-window budgets are persisted so all workers and restarts share attempts.
export function consumeBudget(db, key, maximum, now, windowMs = 60000) {
  const postgres = db.dialect === 'postgres',
    current = postgres ? 'budget.' : '';
  const row = db
    .prepare(
      `INSERT INTO request_budgets${postgres ? ' AS budget' : ''}(key,count,reset_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN ${current}reset_at<=? THEN 1 ELSE ${postgres ? 'LEAST' : 'MIN'}(${current}count+1,?) END,
      reset_at=CASE WHEN ${current}reset_at<=? THEN excluded.reset_at ELSE ${current}reset_at END
    RETURNING count,reset_at`,
    )
    .get(key, now + windowMs, now, maximum + 1, now);
  const result = (row) => ({
    allowed: row.count <= maximum,
    retryAfter: Math.max(1, Math.ceil((row.reset_at - now) / 1000)),
  });
  return postgres ? row.then(result) : result(row);
}
export function initializeBudgets(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS request_budgets(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL)',
  );
}
