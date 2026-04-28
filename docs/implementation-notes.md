# Implementation notes

Working notes for the next SocialSplitApp backend increment.

## Next MVP layer

- async-compatible store contract across Fastify routes and auth context;
- `prisma` provider now owns the current MVP read/write flow directly through PostgreSQL;
- provider surface is reduced to `memory` and `prisma`;
- keep contract tests for both in-memory and Prisma-backed store implementations;
- item-level split for restaurant receipts now works through expense items and item-scoped share rules;
- group participation profiles now support linked users, guests, and children as reusable presets;
- existing collections can now import missing categories from a saved group template.

## Next backend step

- wire the new live PostgreSQL integration lane into CI;
- start hardening Prisma mutations with idempotency/concurrency guards for calculation and payment flows.
