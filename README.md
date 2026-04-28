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

Experimental persistence mirror:

```bash
$env:STORE_PROVIDER="prisma-mirror"
npm run dev
```

`prisma-mirror` keeps in-memory execution semantics, dual-writes the current MVP flow into PostgreSQL, and hydrates persisted runtime state back on startup. Covered: users, friendships, groups, templates, collections, participants, categories, expenses, share rules, calculations, disputes, manual payments, audit log, and collection-scoped notifications.

Direct Prisma-backed runtime facade:

```bash
$env:STORE_PROVIDER="prisma"
npm run dev
```

`prisma` reloads runtime state from PostgreSQL before each operation and then executes the current business flow through the existing store logic. This moves request-time state sourcing onto Postgres while the domain logic is still being migrated away from the in-memory core.

Direct Prisma write/read now covers:

- auth user bootstrap and profile;
- friends;
- groups and group members;
- group templates;
- collections;
- participants;
- collection categories;
- expenses and expense payments;
- expense share rules;
- collection review notifications.

Calculations, disputes, manual payments, audit log, and related review flows still go through the current fallback store path.

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
