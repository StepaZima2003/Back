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
- collections with organizer participant and collection categories.

Expenses, calculations, disputes, manual payments, notifications, and audit logs are still memory-only in this mode.

## Persistence Roadmap

1. Keep calculation logic pure and independent from Prisma.
2. Expand mirror coverage to participants, expenses, share rules, calculations, disputes, manual payments, notifications, and audit logs.
3. Add read-side hydration from Prisma so restart no longer loses mirrored data.
4. Run the same API smoke tests against both `InMemoryStore` and the Prisma-backed store contract.
5. Switch production bootstrap to a full Prisma store behind an environment flag.
