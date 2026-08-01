# nemoProject

## Стек

pnpm + turbo монорепо на TypeScript.

- `apps/miniapp` — Telegram Mini App (основной интерфейс клиента) и вебхук бота на grammY.
- `apps/admin` — админ-панель для менеджеров, отдельный деплой.
- `packages/db` — схема и доступ к Postgres через Drizzle.
- `packages/types` — доменные типы и денежная арифметика.
- `packages/crypto` — асимметричное шифрование реквизитов.

Два приложения, а не одно: приватный ключ расшифровки реквизитов
физически отсутствует в клиентском деплое (docs/adr/0002).

Денежные величины — `numeric(38, 18)`, в коде строки, арифметика через
`Money` из `@nemo/types`. Целочисленное хранение в минорных единицах
переполняется на криптовалютах с 18 знаками.

AI-консьерж работает на DeepSeek через Anthropic-совместимый эндпоинт
`https://api.deepseek.com/anthropic` — клиент Anthropic SDK используется
без изменений, провайдер переключается переменными окружения.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root, ADRs under `docs/adr/`. See `docs/agents/domain.md`.
