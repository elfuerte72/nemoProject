# Пачка 2. Четыре новых рода записи: домен, база, ядро

Status: ready-for-agent

Спека: `../spec.md`, «Домен», «База», «Решения по тестам → Домен, Ядро».
Истории 9–10, 14–16, 18, 20, 23, 29–30.

## Что сделать

Домен (`packages/types/src/domain.ts`):

- `requisiteKinds` += `account` (тайский счёт), `promptpay` (Thai QR),
  `alipay` (аккаунт Alipay), `alipay_qr` (QR приёма Alipay).
- Таблица «валюта → роды»: RUB — phone, card; THB — account, promptpay;
  CNY — alipay, alipay_qr; USDT — wallet; прочие — пусто. Функции
  `requisiteKindsFor(code)` и `requisiteKindSuitsCurrency(kind, code)`.
  Нынешняя `requisiteKindSuits(kind, currencyKind)` остаётся только у
  счетов сервиса и новые роды не пропускает.
- Тип идентификатора PromptPay: `phone`, `national_id`, `ewallet`.
  Способ выдачи из записи: `payoutMethodOf({kind, promptpayIdType})` —
  ewallet → wallet, phone/national_id → bank; account → bank; alipay и
  alipay_qr → wallet.
- Правдоподобие: `looksLikeThaiAccountNumber` (10–12 цифр после снятия
  разделителей), `parsePromptPay(payload)` (EMVCo: формат 01, шаблон
  счёта с AID `A000000677010111`, ровно один идентификатор 01/02/03,
  CRC сходится, поля 54 нет — иначе отказ словами), `looksLikeAlipayQr`
  (ссылка на домен Alipay, регистр не важен), `looksLikeAlipayAccount`
  (телефон или e-mail), `looksLikeHolderName`.
- Хвосты для подписи: у счёта последние четыре цифры, у QR — хвост
  идентификатора (PromptPay) или кода ссылки (Alipay).

База (`packages/db`):

- Новые значения `requisite_kind`; колонки `client_requisites`:
  `holder_name`, `account_last4`, `account_sealed`, `qr_sealed`,
  `qr_hint`, `promptpay_id_type`, `alipay_account`.
- `client_requisites_fields_by_kind` дописать на четыре рода и
  закончить `else false`; `service_accounts_fields_by_kind` — `else
  false`. Миграция без переноса данных. Новые значения enum в `CHECK`
  сравнивать через `::text`: миграции идут одной транзакцией, а новое
  значение enum в ней ещё не используется.

Ядро (`packages/core`):

- `saveRequisites` на четыре рода: счёт и QR шифруются, хвост открыт,
  имя обязательно; `RequisitesView` получает `holderName`,
  `accountLast4`, `qrHint`, `promptpayIdType`, `alipayAccount`.
- `requireSuitableRequisites` — по таблице «валюта → роды».
- `readPayoutMethod` в подаче и `isRequestPricedBySchedule` — по записи.
- `revealRequisites` отдаёт расшифрованный счёт и содержимое QR.
- `describeRequisites` — подписи новых родов; выплата баллов новые роды
  отвергает.

## Приёмка

- Чистые функции на фикстурах: телефон, ID-карта, кошелёк, QR с суммой,
  битая CRC, чужой стандарт (bill payment `…0112`), ссылки Alipay в
  обоих регистрах, номер счёта с разделителями и без, 9 и 13 цифр.
- Ограничение базы: тайский счёт без имени отвергается; PromptPay без
  типа идентификатора; незнакомый род у счёта сервиса — отказ
  (`else false`).
- Операции против базы: запись сохраняется и показывает клиенту только
  хвост; запись не того рода для валюты отвергается при подаче; способ
  выдачи из записи выбирает сетку (PromptPay-кошелёк — кошельковая,
  PromptPay-телефон — банковская, Alipay — кошельковая); раскрытие
  возвращает расшифрованное и пишет журнал; выплата баллов новую запись
  не принимает; счёт сервиса в батах не заводится.

## Comments
