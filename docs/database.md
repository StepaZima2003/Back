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

## Persistence Roadmap

1. Keep calculation logic pure and independent from Prisma.
2. Introduce repository interfaces around users, collections, participants, expenses, disputes, manual payments, notifications, and audit logs.
3. Add a Prisma-backed repository implementation.
4. Run the same API smoke tests against both `InMemoryStore` and `PrismaStore`.
5. Switch production bootstrap to `PrismaStore` behind an environment flag.
