export const tenantSchema = `
  CREATE TABLE IF NOT EXISTS tenant_accounts (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tenant_sessions (
    token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES tenant_accounts(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tenant_sessions_expiry ON tenant_sessions(expires_at);
  CREATE TABLE IF NOT EXISTS tenant_favorites (
    account_id TEXT NOT NULL REFERENCES tenant_accounts(id) ON DELETE CASCADE,
    listing_id INTEGER NOT NULL REFERENCES listings(id), PRIMARY KEY(account_id,listing_id)
  );
`;
