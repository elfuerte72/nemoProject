# Схема и правила ядра: глубина, уровни, личные ставки, коды

Status: ready-for-agent
Этап: 1

Миграция `0031_referral_program` по спеке, раздел «Схема»: таблицы
`referral_lines` (данные из двух колонок настроек, колонки и их check
удаляются), `referral_tiers` + `referral_tier_rates`,
`client_referral_rates`, `referral_codes` (enum `referral_code_kind`;
данные — строка `link` «Основная» на каждого клиента; уникальный индекс
по `upper(code)`; `clients.referral_code` становится nullable и не
пишется), `clients.referred_via_code_id`, `referrals_line_range` —
`between 1 and 5`, `bonus_transactions.staff_id`. Сгенерировать
`drizzle-kit generate --name referral_program`, дописать data-миграцию
и комментарий, как в `0001` и `0025`.

Типы (`@nemo/types`): `MAX_REFERRAL_DEPTH = 5`, `ReferralLine` — `1..5`
(`referralLines`, `referralLineSchema`), `ReferralCodeKind`, правила
промокода (`promoCodeSchema`: 4–16 знаков, латиница и цифры, без
регистра, стоп-список) и ссылки; порядковые слова линии для текстов
(`referralLineWord(line)`: «первой» … «пятой»).

Ядро:

- `referral-program.ts`: `readReferralProgram(executor)` — линии и
  уровни; `effectiveReferralRates(executor, referrerId)` — по каждой
  линии до глубины `{line, rateBps, source: 'individual' | 'tier' |
  'base', tierName}`, уровень — по числу активных рефералов первой
  линии реферера; `updateReferralLines`, `upsertReferralTier`,
  `deleteReferralTier`, `setClientReferralRates` — администратору, с
  `recordSettingsChange`.
- `referral-accruals.ts`: по линиям из `referrals` не глубже
  настроенной, ставка из `effectiveReferralRates`; уведомление несёт
  линию 1..5.
- `clients.ts`: `registerClient` — код из `referral_codes` любого вида
  (без учёта регистра, только действующий), цепочка до
  `MAX_REFERRAL_DEPTH` обходом по `clients.referrer_id` внутри
  транзакции, `referred_via_code_id`; `bindReferrerByPromoCode(actor,
  code)` — нет реферера, нет заявок, не свой код, иначе отказ словами.
- `referral-codes.ts`: `listReferralCodes`, `createReferralCode`
  (до десяти действующих; промокод — по схеме, ссылка — сгенерирована),
  `archiveReferralCode`; «основной» код — самая ранняя действующая
  ссылка (нужен боту).
- `bonus-adjustments.ts`: `adjustBonus(actor, clientId, {amount,
  comment})` — администратору, комментарий обязателен, снять ниже нуля
  нельзя (`for update` строки клиента), `staff_id` в строке.
- `settings.ts`: из `ServiceSettingsView` уходят `referralLine1Bps` /
  `referralLine2Bps`; `admin.ts` — из `UpdateServiceSettingsInput` тоже;
  `test-support.ts` — `givenReferralLines`, `givenReferralTier`.
- `notifications.ts`, `concierge-facts.ts`: линия 1..5 словами, ставки
  списком по линиям.

Тесты (с падающего): цепочка до пятой линии и не глубже; начисление по
трём линиям при глубине три и молчание четвёртой при цепочке в пять;
старшинство «личная → уровень → базовая» по линиям отдельно; уровень
по активным рефералам первой линии (реферал без исполненной заявки не
считается); прошлые начисления не меняются при смене линий и уровней;
промокод: регистр, стоп-список, уникальность с кодами ссылок, свой код,
клиент с заявкой — отказ; правка баллов: комментарий обязателен, ниже
нуля нельзя, менеджеру отказ; миграция данных — `constraints.test.ts`
и тест на «Основная» у существующего клиента.

Готово, когда `pnpm typecheck`, тесты ядра, db и обоих приложений
зелёные без правок ожиданий в тестах клиента и Mini App, кроме тех,
что читали `line1Bps`/`line2Bps`.
