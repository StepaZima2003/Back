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

Read-side hydration is still not implemented in this mode, so process restart still drops the runtime state even though the mirror writes are persisted.

## Persistence Roadmap

1. Keep calculation logic pure and independent from Prisma.
2. Add read-side hydration from Prisma so restart no longer loses mirrored data.
3. Run the same API smoke tests against both `InMemoryStore` and the Prisma-backed store contract.
4. Switch production bootstrap to a full Prisma store behind an environment flag.
5. Remove the mirror transitional layer after the full Prisma store owns writes directly.
