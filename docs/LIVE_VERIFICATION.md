# Live free-infrastructure verification — 2026-11-09

- Render Free uses a separate Neon Free PostgreSQL database with verified TLS; there is no persistent Render disk or paid worker.
- Application deployment `dep-dborq4ufephs73c8v3fg` initialized the schema from demo data. The owner-approved synthetic inquiry was submitted through the HTTPS public form and produced inquiry 1 plus one atomic outbox event.
- The scheduled Neon Function accepted that event at `2026-11-09T12:45:02.097Z`: attempted 1, delivered 1, failed 0. PostgreSQL recorded attempts=1, delivered_at at that same instant and last_error=null. This confirms provider acceptance, not receipt on the owner's device.
- A subsequent actual application deployment `dep-dbos7q8473hc73b09e00`, source `d3eb0a48c3e2a52e61f5117fba206e42858eb962`, reached live at `13:01:16 UTC`. A database read after deployment found the same synthetic inquiry 1 and unchanged delivery timestamp, attempt count and error state. Both inquiry and delivery history survived the application restart.
- Trigger `nestly-notifications` is enabled at `*/15 * * * *`. Its subscription secret is outside this repository. The owner must subscribe and confirm device receipt separately.
- PostgreSQL integration, historical SQLite upgrade, browser demo and desktop/mobile browser tests passed in CI. Updated receipt screenshots use fixture API responses; they are UI documentation, not push-delivery evidence.

This is application-restart persistence. Independent backup recovery and owner-device receipt were not verified here.
