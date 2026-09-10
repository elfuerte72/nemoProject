# Ядро: отметка амбассадора и вход по подписи Telegram

Status: ready-for-agent
Спека: `../spec.md`
Blocked by: 01

Миграция `0032_ambassadors`: таблица `ambassadors` — `client_id` (PK,
→ `clients.telegram_user_id`), `title`, `note`, `created_by` (→
`staff.id`), `created_at`, `revoked_at`. Снятие отметкой, не удалением
строки.

Операции:

- `signInAmbassador(telegramUserId)` — отметка есть и не снята;
  возвращает то, что кабинет положит в сессию. Право решает ядро.
- `listAmbassadors(actor, {query?})`, `addAmbassador(actor,
  {telegramUserId, title, note})`, `revokeAmbassador`,
  `restoreAmbassador` — администратору, всё в `recordSettingsChange`.
- `addAmbassador` заводит запись клиента с реферальным кодом, если
  такого клиента ещё нет: блогер мог не открывать Mini App, а ссылка
  нужна ему в день заведения.

Проверка подписи виджета переезжает из панели
(`apps/admin/lib/auth/telegram-login.ts`) в общее место, откуда её
берут оба приложения. Секрет там — `SHA256` от токена бота, а не
`HMAC("WebAppData", …)`, как у Mini App; перепутать легко, и тест на
это уже есть — он едет вместе с кодом.

Начинать с падающего теста: правило ядра, деньги и доступ. Проверить,
что снятый амбассадор не входит, что начисленное ему остаётся, что
заведение по чужому Telegram ID не даёт доступа к чужому счёту.
