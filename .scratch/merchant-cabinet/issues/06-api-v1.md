# API v1: ключи, маршруты, журнал, документация

Status: ready-for-agent
Этап: 3
Blocked by: 05

Схема: `api_keys` (мерчант, публичная часть для показа, хеш секрета,
подпись словами, выдан, отозван, последняя активность),
`api_request_log` (время, ключ, метод, путь, код, длительность, адрес,
текст ошибки). Операции: `issueApiKey` (секрет возвращается один раз и
не хранится), `revokeApiKey`, `listApiKeys`, `authenticateApiKey`,
`logApiRequest`, `listApiRequestLog(filter, cursor)`,
`purgeApiRequestLog(olderThan)`; `merchants.signature_required` и
`setSignatureRequired`.

Адаптер `requireApiKey(request)` в `apps/cabinet/lib/api.ts`:
`Authorization: Bearer <ключ>`; при включённой подписи — `x-api-key`,
`x-timestamp`, `x-signature` по `method + path + timestamp +
sha256(body)`, окно пять минут, повтор той же подписи отвергается.
Лимит сто в минуту и тысяча в час по ключу в памяти процесса, ответ
`429` с `retry-after`. Каждый вызов пишется в журнал, в том числе
отвергнутый. Тело ошибки `{ error: { code, message } }`; коды ядра
через `statusForCoreError`.

Маршруты `/api/v1`: `GET /rates`, `POST /quote`,
`POST /exchange-requests` (обязательный `Idempotency-Key`, `reference`,
получатель `requisitesId` или `payout`, `quotedAt` по желанию;
наличные отвергаются), `GET /exchange-requests/:id`,
`GET /exchange-requests?status&after`, `POST
/exchange-requests/:id/cancel`, `GET /requisites`, `POST /requisites`,
`DELETE /requisites/:id`. Отключённому мерчанту — `401` на любой
запрос. Подача зовёт `nudgeStaffAlerts`, как Mini App.

Договор — `docs/api/merchant-v1.yaml` (OpenAPI 3.1): пишется до
маршрутов; тест перечисляет маршруты приложения и сверяет с файлом,
пример каждого ответа — фикстурой. Раздел **Документация** в кабинете
рендерит файл; раздел **API**: ключи (выпуск с показом секрета один
раз и предупреждением, отзыв, подпись словами), тумблер подписи,
лимиты, пример на Node.js с настоящим публичным ключом мерчанта;
раздел **Журнал вызовов** с плитками и фильтрами; раздел
**Песочница**: адрес тестового кабинета и чем `sk_test_` отличается.
В карточке мерчанта панели — блок ключей без секретов и последняя
активность. Письма о выпуске и отзыве ключа.

Планировщик: `POST /api/maintenance/purge-logs` с
`SCHEDULER_SECRET`, раз в сутки, по образцу README.

Тесты: подпись сходится и не сходится, окно, повтор; лимит; повтор
`Idempotency-Key`; `payout` неправдоподобный; наличная заявка; журнал
пишет отвергнутый вызов; OpenAPI сверка. Живая проверка на песочнице
скриптом от начала до конца. `CHANGELOG.md`: API мерчанта.
