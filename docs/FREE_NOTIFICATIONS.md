# Free ntfy push notifications

As an alternative to a signed CRM webhook, set `NTFY_TOPIC` to a random
32–128 character string (`openssl rand -hex 24` is suitable). Keep it in the
server environment, outside Git, and clear `INQUIRY_WEBHOOK_URL` when selecting
ntfy. Subscribe at `https://ntfy.sh/<your-topic>` in the browser or ntfy app.

The existing durable event queue sends only the project name and inquiry ID.
Names, phone numbers and message text stay in the application's owner area.
The same leases, five attempts and manual retry apply to ntfy. After a lost
acknowledgement, duplicates can occur: ntfy does not guarantee deduplication.

ntfy.sh supports anonymous free use, currently up to 250 messages per day per
visitor. Topics on the free public server are unlisted, not authenticated
private channels. Treat the random topic as a subscription secret and do not
publish it in source code or screenshots. Delivery and quota are best effort;
check the owner queue even if no notification arrives. Creating this adapter
does not deploy the server or configure the recipient environment automatically.

Provider documentation: https://docs.ntfy.sh/publish/ and https://docs.ntfy.sh/privacy/.

For a free scheduled worker that runs while Render sleeps, see
[PostgreSQL and Neon Functions setup](FREE_POSTGRES.md). The one-shot CLI
equivalent is `node notification-worker.js --once`; missing delivery settings
fail before events can be acknowledged. Do not run the continuous polling mode
against Neon Free without accounting for its compute quota.
