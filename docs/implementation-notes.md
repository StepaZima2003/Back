# Implementation notes

Working notes for the next SocialSplitApp backend increment.

## Next MVP layer

- async-compatible store contract across Fastify routes and auth context;
- `prisma-mirror` now covers the current MVP write flow;
- add read-side hydration from Prisma to survive process restart;
- keep contract tests for both in-memory and Prisma-backed store implementations;
- add item-level split for restaurant receipts;
- add participation profiles and group-level category presets.
