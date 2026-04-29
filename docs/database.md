# Database Setup

The API still uses `InMemoryStore` by default, but the project now has a PostgreSQL schema and migration baseline that mirrors the MVP 1 domain model from the technical specification.

## Local Postgres

```bash
# PowerShell: Copy-Item .env.example .env
cp .env.example .env
docker compose up -d postgres
npm run db:deploy
npm run db:seed
```

Default connection string:

```text
postgresql://socialsplit:socialsplit@localhost:5432/socialsplit?schema=public
```

## Prisma Commands

```bash
npm run db:validate
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:seed
npm run test:integration
```

Use `db:migrate` while changing the schema locally. Use `db:deploy` for applying checked-in migrations.

## Store Provider

Default bootstrap is `STORE_PROVIDER=memory`.

There is also a more aggressive `STORE_PROVIDER=prisma` mode:

```bash
$env:STORE_PROVIDER="prisma"
npm run dev
```

This mode now uses PostgreSQL as the working source of truth for the current MVP store flow. The calculation engine still runs as a pure in-process function, but reads/writes for collections, participants, expenses, calculations, disputes, manual payments, notifications, and audit records are persisted directly through Prisma.

Direct Prisma read/write is already used here for the stable slice:

- user bootstrap and profile;
- friendships;
- groups and members;
- group participant profiles;
- group templates;
- collections;
- participants;
- adding participants from saved group profiles;
- collection categories;
- applying template categories to an existing collection;
- expenses and expense payments;
- expense items and item-scoped share rules;
- expense share rules;
- calculations, participant calculations, responsible-payer calculations, and transfer plans;
- participant review confirmations;
- disputes;
- manual payment proofs;
- notifications;
- audit log.

Route-level smoke tests now exercise the same collection flows against `memory` and `prisma` providers through a shared stateful Prisma mock.

Money-flow hardening now includes:

- advisory transaction locks around Prisma calculation and manual-payment mutation paths;
- duplicate `calculate` dedup when the financial result did not change;
- retry-safe manual payment submit via `idempotencyKey`;
- idempotent confirm/reject behavior for terminal manual payment states.

The same backend now has a mock payment slice for non-production payment work:

- `payment_methods` now support a fuller setup lifecycle: `requires_confirmation -> active|failed -> revoked`;
- mock setup sessions persist provider customer references, setup references, confirmation timestamps, and setup failure markers;
- legacy `mock-bind` still exists as a shorthand, but the primary flow is now setup-session based;
- `auto_payment_rules` are persisted and queryable by user/collection/group scope;
- `payments` are persisted as simulated provider intents with `pending -> succeeded|failed|refunded` transitions;
- payment methods now persist provider token references and provider metadata snapshots;
- payment intents now persist `paymentMethodId`, `providerStatus`, `providerMetadata`, attempt counters, and last webhook markers;
- mock payment intent creation is also idempotent through the existing retry discipline;
- the latest calculation can now be transformed into an organizer-reviewed auto payment preview/execution batch;
- category-scoped rules can split one participant into multiple simulated payment intents when needed;
- internal due-autopay sweep can traverse all eligible collections and create pending intents without user interaction;
- generic signed provider webhooks can finalize those intents into `succeeded`, `failed`, or `refunded`;
- inbound provider webhook events are persisted and deduplicated by external `eventId`;
- failed webhook events now keep retry metadata (`attemptCount`, `lastAttemptedAt`, `nextRetryAt`, `deadLetteredAt`);
- retry-safe replay can recover previously failed webhook events after the matching payment appears later;
- terminal webhook misses now move into a dead-letter state instead of retrying forever;
- internal operators can now inspect persisted webhook events by status/provider and manually replay one specific event;
- route-level parity and live PostgreSQL integration now cover the mock payment/autopay flow.

There is now a dedicated background worker path for auto payments:

```bash
$env:STORE_PROVIDER="prisma"
$env:AUTOPAY_SWEEP_ENABLED="true"
$env:AUTOPAY_SWEEP_INTERVAL_MS="60000"
npm run dev
```

That mode starts the API and an in-process scheduler together. For a separate worker process, use:

```bash
$env:STORE_PROVIDER="prisma"
$env:AUTOPAY_SWEEP_ON_BOOT="true"
$env:AUTOPAY_SWEEP_INTERVAL_MS="60000"
npm run autopay:worker
```

Relevant worker env vars:

- `AUTOPAY_SWEEP_ENABLED`: turns on the scheduler inside `src/api/server.ts`;
- `AUTOPAY_SWEEP_ON_BOOT`: runs one sweep immediately after startup before polling;
- `AUTOPAY_SWEEP_INTERVAL_MS`: poll interval for the persistent sweep loop;
- `PAYMENT_WEBHOOK_RETRY_ENABLED`: turns on the failed-webhook retry scheduler inside `src/api/server.ts`;
- `PAYMENT_WEBHOOK_RETRY_ON_BOOT`: runs one webhook retry sweep immediately after startup;
- `PAYMENT_WEBHOOK_RETRY_INTERVAL_MS`: poll interval for the persistent webhook retry loop;
- `INTERNAL_API_TOKEN`: still protects the manual `/internal/autopay/run-due` trigger;
- `MOCK_PROVIDER_WEBHOOK_SECRET`: signs and verifies mock PSP webhooks.

There is also a one-shot replay command for operational recovery:

```bash
$env:STORE_PROVIDER="prisma"
npm run payments:webhooks:retry
```

For targeted recovery, the internal HTTP surface now also exposes:

- `GET /internal/payments/webhooks/events`
- `POST /internal/payments/webhooks/{eventId}/replay`

There is also a live PostgreSQL lane:

```bash
docker compose up -d postgres
npm run test:integration
```

`test:integration` resets a dedicated `integration` schema, applies checked-in Prisma migrations, and runs real API scenarios against `PrismaStore`.

This same split now runs in GitHub Actions:

- `quality` job for fast regression checks;
- `integration` job for live PostgreSQL coverage against the checked-in migrations.

## Persistence Roadmap

1. Keep calculation logic pure and independent from Prisma.
2. Replace the mock PSP transport with a real adapter, real customer/payment-method token references, and provider-specific webhook schemas.
3. Add alerting / dead-letter inspection tooling around failed webhook events.
4. Move from polling-only orchestration to queue-backed execution if batch volume grows past one process.
