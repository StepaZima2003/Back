# Implementation notes

Working notes for the next SocialSplitApp backend increment.

## Next MVP layer

- async-compatible store contract across Fastify routes and auth context;
- `prisma-mirror` now covers the current MVP write flow;
- `prisma-mirror` now hydrates persisted runtime state on startup;
- `prisma` provider now reloads runtime state from PostgreSQL before each operation;
- `prisma` provider now writes the stable slice directly through Prisma;
- keep contract tests for both in-memory and Prisma-backed store implementations;
- add item-level split for restaurant receipts;
- add participation profiles and group-level category presets.
