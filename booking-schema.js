export const bookingSchema = `
  CREATE TABLE IF NOT EXISTS tenant_bookings (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES tenant_accounts(id),
    listing_id INTEGER NOT NULL REFERENCES listings(id),
    start_date TEXT NOT NULL, end_date TEXT NOT NULL CHECK(start_date < end_date),
    amount_rub INTEGER NOT NULL CHECK(amount_rub > 0),
    status TEXT NOT NULL, expires_at BIGINT NOT NULL, payment_id TEXT UNIQUE,
    payment_url TEXT
  );
  CREATE INDEX IF NOT EXISTS tenant_bookings_dates ON tenant_bookings(listing_id,start_date,end_date);
  CREATE INDEX IF NOT EXISTS tenant_bookings_tenant ON tenant_bookings(account_id);
`;
