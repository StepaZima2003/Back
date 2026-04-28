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
```

Use `db:migrate` while changing the schema locally. Use `db:deploy` for applying checked-in migrations.

## Store Provider

Default bootstrap is `STORE_PROVIDER=memory`.

There is also an experimental `STORE_PROVIDER=prisma-mirror` mode:

```bash
$env:STORE_PROVIDER="prisma-mirror"
npm run dev
```

`prisma-mirror` keeps `InMemoryStore` as the execution source of truth and dual-writes a stable slice into PostgreSQL:

- users and profile updates;
- friendships;
- groups and group members;
- group templates with template categories;
- collections, participants, and collection categories;
- expenses, payments, and share rules;
- calculation versions with participant/responsible-payer snapshots and transfer plans;
- disputes;
- manual payment proofs;
- audit log;
- collection-scoped notifications.

On startup, `prisma-mirror` now hydrates persisted users, groups, templates, collections, participants, expenses, calculations, disputes, manual payments, audit logs, and notifications back into the in-memory runtime layer.

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
- group templates;
- collections;
- participants;
- collection categories;
- expenses and expense payments;
- expense share rules;
- calculations, participant calculations, responsible-payer calculations, and transfer plans;
- participant review confirmations;
- disputes;
- manual payment proofs;
- notifications;
- audit log.

## Persistence Roadmap

1. Keep calculation logic pure and independent from Prisma.
2. Run the same API smoke tests against `memory`, `prisma-mirror`, and `prisma` providers.
3. Remove the mirror transitional layer after provider parity is confirmed.
4. Add real integration coverage against a live PostgreSQL container in CI.
