# Мерчант в ядре и схеме: второй владелец заявки

Status: done
Этап: 1

Таблица `merchants` (поля по спеке, раздел «Схема»), `merchant_id` у
`exchange_requests`, `client_requisites`, `requisite_access_log` с
ограничением «ровно один владелец» (`client_id` или `merchant_id`);
у заявки `reference` и `idempotency_key`, уникальный в пределах
мерчанта. Одна миграция.

`Actor` получает `{ type: 'merchant', merchantId }`; в `actor.ts` —
`requireOwner(actor)`, отдающий `{ clientId } | { merchantId }`.
Обобщаются до владельца: `getExchangeTerms`, `getQuote`,
`submitExchangeRequest` (принимает `reference`, `idempotencyKey`,
`payout` — реквизиты в теле, которые заводятся записью и сразу
архивируются), `listExchangeRequests` (плюс фильтр по состоянию и
периоду и курсор по паре «время подачи и идентификатор»),
`getExchangeRequest`, `cancelOwnExchangeRequest`, `saveRequisites`,
`listRequisites`, `archiveRequisites`, `revealRequisites`. Новая
`listExchangeRequestEventsForOwner`: своя заявка, без имён сотрудников.
Баллы, выводы, карта, рассылки, переписка остаются клиентскими и на
мерчанта отказывают `ForbiddenError`.

`completeExchangeRequest` не начисляет реферальные баллы по заявке
мерчанта. `Notification.to` становится адресатом: клиент по Telegram ID
или мерчант по `merchantId`; `@nemo/telegram` доставляет только
клиентские и молча пропускает остальные. `NewRequestSubject` и
`renderStaffNotification`: у заявки мерчанта название и `reference`
вместо ника. Операции мерчанта для панели: `listMerchants(filter)`,
`getMerchantCard`, `approveMerchant`, `rejectMerchant(reason)`,
`setMerchantActive`; регистрация и вход: `registerMerchant`,
`verifyMerchantEmail`, `beginMerchantLogin` (проверка пароля, поколение
сессии), `changeMerchantPassword`, `requestPasswordReset`,
`resetPassword`. Пароль — `argon2id`.

Тест-первым на настоящей базе: заявка без владельца и с двумя
отвергается базой; мерчант не видит чужую заявку и заявку клиента;
повтор `idempotencyKey` возвращает ту же заявку; `payout` с
неправдоподобной картой отвергается словами из `REQUISITE_COMPLAINTS`;
исполнение заявки мерчанта не пишет `bonus_transactions`; наличная
заявка мерчанту отвергается; отключённый мерчант не подаёт; смена
пароля увеличивает поколение; все существующие тесты клиента зелёные
без правок ожиданий.

ADR «Мерчант — второй владелец заявки со своим аккаунтом»: пересмотр
ADR-0004 только для мерчантов, с доводом «сайт, а не Telegram» и ценой.
`CONTEXT.md`: термин «Мерчант» в разделе «Люди», у заявки на обмен —
«владелец: клиент или мерчант».

---

## Сделано 6 сентября 2026

Схема: `merchants`, `merchant_email_tokens`, второй владелец у трёх
таблиц с ограничением «ровно один», `reference` и `idempotency_key` у
заявки, `service_settings.merchant_support_username`. Миграция
`0028_merchant_owner`.

Ядро: `Actor` с третьим видом и `requireOwner`/`Owner`; обобщены подача
(включая `payout` в теле и повтор по ключу), список с курсором,
карточка, отмена, реквизиты, показ реквизитов менеджеру; новая
`listExchangeRequestEventsForOwner`. Баллы по заявке мерчанта не
начисляются. `Notification.to` у уведомлений о заявке стал адресатом
(`Recipient`), `@nemo/telegram` пропускает чужих; `NewRequestSubject`
получил `RequestParty`. Операции мерчанта — в `merchants.ts`; пароль —
argon2id через `hash-wasm` в `@nemo/crypto`.

Тесты: `merchants.test.ts` (22), `merchant-exchange.test.ts` (21),
ограничения базы в `constraints.test.ts`, поиск и фильтр очереди в
`exchange-queue.test.ts`. Весь прогон зелёный.

ADR — `docs/adr/0017-merchant-vtoroy-vladelec-zayavki.md`; термин
«Мерчант» и владелец заявки — в `CONTEXT.md`.

Не сделано намеренно и записано в `backlog.md`: второй фактор,
ограничение попыток входа, доставка писем.
