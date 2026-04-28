# SocialSplitApp

Стартовая реализация MVP 1 по ТЗ `Social Split App Full Tz V2.pdf`.

Первый инкремент фокусируется на backend как источнике истины:

- модульный монолит на Node.js + TypeScript;
- in-memory API для ранней проверки сценариев без базы;
- расчётное ядро отдельно от API и будущих платежей;
- версионирование расчётов на уровне сервиса;
- документация из раздела 35 ТЗ: архитектура, ERD, OpenAPI, user flow, acceptance tests и payment/legal checklist.

## Команды

```bash
npm install
npm run dev
npm test
npm run test:integration
npm run typecheck
npm run build
```

## Database

```bash
# PowerShell: Copy-Item .env.example .env
cp .env.example .env
docker compose up -d postgres
npm run db:deploy
npm run db:seed
```

Details: `docs/database.md`.

Direct Prisma-backed runtime facade:

```bash
$env:STORE_PROVIDER="prisma"
npm run dev
```

`prisma` now uses PostgreSQL as the working source of truth for the current MVP store flow. The split-calculation engine remains pure and in-process, but collection mutations, calculations, disputes, manual payments, notifications, and audit writes are persisted directly through Prisma.

Direct Prisma write/read now covers:

- auth user bootstrap and profile;
- friends;
- groups and group members;
- group participant profiles;
- group templates;
- collections;
- participants;
- adding collection participants from saved group profiles;
- collection categories;
- applying template categories to an existing collection;
- expenses and expense payments;
- expense items and item-scoped share rules;
- expense share rules;
- calculations with version snapshots, participant/responsible-payer rows, and transfer plans;
- participant review confirmations;
- disputes;
- manual payments;
- notifications;
- audit log.

API smoke parity is now covered in tests for `memory` and `prisma` providers using the same route-level scenarios.

Live PostgreSQL integration coverage is now available separately:

```bash
docker compose up -d postgres
npm run test:integration
```

The integration lane deploys checked-in Prisma migrations into a dedicated `integration` schema and then runs real Fastify + Prisma scenarios against PostgreSQL.

Recent collection/group additions:

- organizer-owned participant profiles at the group level for recurring members, linked users, guests, and children;
- a collection endpoint for adding participants directly from those saved group profiles;
- a collection endpoint for applying missing category presets from an existing group template;
- route-level provider parity coverage for both flows.

Retry/concurrency hardening now covers:

- duplicate `calculate` requests no longer create extra versions when the result is unchanged;
- manual payment submit supports `idempotencyKey` for safe retries;
- Prisma store serializes calculation and manual payment critical sections on PostgreSQL advisory locks.

По умолчанию API стартует на `http://localhost:3000`.

```bash
curl http://localhost:3000/health
```

## Реализовано в первом инкременте

- mock-регистрация по телефону через OTP для dev-среды;
- профиль пользователя;
- друзья и группы в базовом виде;
- создание сбора;
- участники, гости, дети с долей `0.5`, платёжный ответственный;
- ручные расходы и несколько плательщиков одного расхода;
- правила деления: equal, weights, fixed, percent, excluded, cap;
- расчёт по участникам и платёжным ответственным;
- минимизированный план переводов;
- объяснение суммы и предупреждения расчётного движка;
- сохранение версий расчёта в памяти;
- API smoke test и unit-тесты расчётного ядра.
- подтверждение расчёта участником;
- споры по расчёту с accept/reject/resolve flow;
- ручные оплаты с proof/comment и подтверждением организатором или получателем;
- audit log и уведомления для review, споров и ручных оплат.
- default categories по типу сбора;
- групповые шаблоны сборов;
- создание сбора из шаблона с категориями шаблона.

## Важное ограничение

Это не production-хранилище: данные живут в памяти процесса. Следующий технический шаг - заменить store на PostgreSQL/Prisma или Drizzle, не меняя контракт расчётного ядра.
