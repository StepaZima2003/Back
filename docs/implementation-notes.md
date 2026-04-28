# Implementation notes

Working notes for the next SocialSplitApp backend increment.

## Next MVP layer

- async-compatible store contract across Fastify routes and auth context;
- `prisma` provider now owns the current MVP read/write flow directly through PostgreSQL;
- provider surface is reduced to `memory` and `prisma`;
- keep contract tests for both in-memory and Prisma-backed store implementations;
- add item-level split for restaurant receipts;
- add participation profiles and group-level category presets.
