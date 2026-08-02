# nemoProject

## Стек

pnpm + turbo монорепо на TypeScript.

- `apps/miniapp` — Telegram Mini App (основной интерфейс клиента) и вебхук бота на grammY.
- `apps/admin` — админ-панель для менеджеров, отдельный деплой.
- `packages/core` — прикладные операции: единственное место, где меняется состояние.
- `packages/http` — общая обвязка маршрутов: карта отказов ядра в коды HTTP, JSON без потери точности.
- `packages/telegram` — доставка уведомлений клиенту: её выполняют оба приложения.
- `packages/db` — схема и доступ к Postgres через Drizzle.
- `packages/types` — доменные типы и денежная арифметика.
- `packages/crypto` — асимметричное шифрование реквизитов.
- `packages/rates` — котировки Rapira: реализация интерфейса источника
  курса из `@nemo/core`.

Два приложения, а не одно: приватный ключ расшифровки реквизитов
физически отсутствует в клиентском деплое (docs/adr/0002).

Приложения — тонкие адаптеры: маршрут разбирает запрос, вызывает операцию
`@nemo/core`, отдаёт результат. В базу они не пишут и `@nemo/db` не
импортируют — подключение реэкспортировано из `@nemo/core`, чтобы прямой
импорт схемы в маршруте бросался в глаза.

Postgres поднимается через `docker compose up -d` (базы `nemo_dev` и
`nemo_test`). Тесты операций идут против настоящей базы: часть правил —
обязательность дохода при исполнении, уникальность начисления, запрет
самореферала — выражена ограничениями Postgres, и мок их не проверит.

Денежные величины — `numeric(38, 18)`, в коде строки, арифметика через
`Money` из `@nemo/types`. Целочисленное хранение в минорных единицах
переполняется на криптовалютах с 18 знаками.

AI-консьерж работает на DeepSeek через его Anthropic-совместимый эндпоинт
`https://api.deepseek.com/anthropic`: клиент Anthropic SDK используется без
изменений, но ключ и адрес передаются в него явно из `DEEPSEEK_API_KEY` и
`DEEPSEEK_BASE_URL`. Переменные названы по провайдеру, а не по SDK — иначе
`.env` вводит в заблуждение относительно того, чей ключ нужен.

Котировки валютных пар для электронных переводов берутся у Rapira
(`RAPIRA_KEY`). Провайдер спрятан за интерфейсом источника курса: наличные
котируются менеджером вручную и через этот интерфейс не проходят.

Второй фактор сотруднику выдаёт администратор — вход его не заводит.
Первый администратор появляется через `pnpm create-first-admin`, и эта
операция работает только на пустом списке сотрудников.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root, ADRs under `docs/adr/`. See `docs/agents/domain.md`.
