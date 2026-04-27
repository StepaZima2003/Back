# Архитектура MVP 1

## Цель первого этапа

MVP 1 проверяет социальный сценарий: пользователь создаёт сбор, добавляет друзей, гостей и детей, вводит расходы, получает понятный расчёт, отправляет его на проверку, обрабатывает споры и закрывает ручные оплаты.

Реальная привязка карт, автосписание, внутренний баланс и хранение денег не входят в MVP 1.

## Стек

- Backend: Node.js, TypeScript, Fastify.
- Validation: Zod.
- Storage для первого инкремента: in-memory repository.
- Target storage: PostgreSQL.
- Calculation Engine: отдельный доменный модуль без зависимости от API.
- API contract: OpenAPI в `docs/openapi.yaml`.
- Tests: Vitest.

## Модульный монолит

На старте используем один backend-процесс, но границы модулей сразу разведены:

- Auth: OTP, сессии, refresh tokens позже.
- Users: профиль и настройки.
- Friends: social graph.
- Groups: группы и участники групп.
- Collections: сборы, участники, расходы, статусы.
- Calculation Engine: расчёты, версии, transfer plan.
- Disputes: подтверждения и возражения.
- Manual Payments: "я оплатил", proof, подтверждения.
- Notifications: напоминания и системные сообщения.
- Audit Log: история действий и спорных изменений.
- Payments: заготовка для MVP 2, без реального списания в MVP 1.

## Принципы

- Backend является источником истины.
- Клиент не рассчитывает финальные суммы самостоятельно.
- Расчётный движок не зависит от HTTP, базы и платежей.
- Все расчёты версионируются.
- Все изменения правил деления должны попадать в audit/share rule log.
- Платёжная логика отделена от расчётной и социальной логики.
- Деньги храним в minor units: копейки для RUB.

## Текущая структура

```text
src/
  api/          HTTP app, routes, server bootstrap
  calculation/  чистое расчётное ядро
  domain/       MVP domain types
  store/        in-memory repository
docs/           архитектура, ERD, OpenAPI и планы
tests/          unit и smoke tests
```

## Следующий слой production-ready backend

1. Добавить PostgreSQL и миграции.
2. Вынести `InMemoryStore` за интерфейс repository.
3. Подключить JWT/session tokens вместо dev-token.
4. Добавить audit log на все state-changing endpoints.
5. Реализовать disputes/manual payments/notifications как отдельные route modules.
6. Подключить OpenAPI generation или contract tests против `docs/openapi.yaml`.

