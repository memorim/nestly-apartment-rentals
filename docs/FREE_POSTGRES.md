# Persistent storage and scheduled delivery without a paid Render disk

Set the Render service's protected `DATABASE_URL` to an external Neon Free
PostgreSQL database, using `sslmode=verify-full`. Keep the existing
`APP_PUBLIC_ORIGIN` and `APP_OWNER_TOKEN`. Remote database connections must
verify certificates and hostnames. The bounded pool closes idle connections.
Without `DATABASE_URL`, the existing local SQLite mode remains available.

The first PostgreSQL startup installs a checksummed migration and the six demo
listings. Inquiries, availability, request budgets, outbox leases and delivery
state then survive application restarts. Concurrent inquiries with the same
idempotency key produce one inquiry/event. Owner writes use transactions;
notification workers claim rows with `FOR UPDATE SKIP LOCKED`. Contacts remain
behind the existing owner authentication.

This rollout uses a fresh database because the owner confirmed that only demo
data exists. An installation with real SQLite data must first make a consistent
private backup and supply its verified snapshot to the migration, with all
five tables preserved. Never initialize an empty destination over the only
copy of real data. Database persistence does not replace independent backups.

## Free scheduled worker

`scheduled-notifications.js` runs on a Neon Function in the same project and
region. It uses the automatically injected database URL and protected
`NTFY_TOPIC` environment variable. It never opens a public route for draining
the queue: `/cron` requires a valid Neon schedule delivery. Neon's edge strips
client-supplied `x-neon-*` headers; the official parser checks the invocation.
The function will not initialize an empty database: the web application must
apply migrations first.

Build with `node scripts/build-notifier.mjs`. The resulting
`.neon-build/notifications.zip` contains the function and the exact migration
files, with no environment secrets. Deploy it as slug `notifications` with
runtime `nodejs24`. The reproducible trigger definition is
`deploy/notifications.json`. Source changes require rebuilding and redeploying
the function separately from the Render web application.

The schedule runs every fifteen minutes and processes at most ten events per
invocation. Retries remain in PostgreSQL; a rejected delivery or lost lease
returns a failing status. Only the project label and inquiry ID reach ntfy;
names, contacts and messages are excluded. Subscription on the owner's device
is a separate operational step. The random topic must stay outside Git.

Fifteen-minute polling gives the free database time to suspend between runs.
Continuous one-second polling, or a five-minute schedule, can keep it awake
and exhaust the monthly free compute allowance. Actual use, requests and
delivery retries still consume provider quotas. Do not switch to a paid plan
automatically when a quota is reached.

References: https://neon.com/docs/introduction/plans,
https://neon.com/docs/compute/functions/triggers/overview,
https://render.com/docs/free and https://docs.ntfy.sh/publish/.

## Verification

The PostgreSQL CI job checks inquiry idempotency, contact budgets, overlapping
owner writes, notification leases and retained state after reopening separate
connections. Existing SQLite, HTTP contract, upgrade and browser tests remain.
A live rollout must separately verify a technical form submission, the durable
queue, scheduled delivery and application redeploy. HTTP acceptance by ntfy
does not prove that an owner's device displayed the notification.
