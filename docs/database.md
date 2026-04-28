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

There is also a live PostgreSQL lane:

```bash
docker compose up -d postgres
npm run test:integration
```

`test:integration` resets a dedicated `integration` schema, applies checked-in Prisma migrations, and runs real API scenarios against `PrismaStore`.

## Persistence Roadmap

1. Keep calculation logic pure and independent from Prisma.
2. Wire the live PostgreSQL integration lane into CI.
3. Extend the same retry/concurrency discipline to future autopay/provider payment flows.
4. Expand persistence coverage toward richer profile/template reuse flows.
