# Документация, окружение, выкат

Status: ready-for-human

CLAUDE.md, CHANGELOG.md, `.env.example` (ключ DeepSeek нужен и панели),
README, ADR 0016, запись в backlog про порядок статей. На Dokploy в
окружение `admin` (dev и prod) добавить `DEEPSEEK_API_KEY`,
`DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` — за Пенкиным.

## Comments

5 сентября 2026: документация написана (CLAUDE.md, CHANGELOG, .env.example,
README, ADR 0016, backlog). Осталось за Пенкиным: ключ DeepSeek в окружении
`admin` на Dokploy и smoke после выката — открыть «Настройки → Помощник»,
вставить абзац текста, увидеть черновик.

6 сентября 2026: переменные добавлены у `admin` на dev и prod
(`/root/dk application.saveEnvironment`, теперь с `buildSecrets`), PR #108
после ревью слит в dev и выкачен на прод (`main = 5ccf6ba`).
