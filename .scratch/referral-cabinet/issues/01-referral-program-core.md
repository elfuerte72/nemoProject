# Схема и правила ядра: глубина, уровни, личные ставки, коды

Status: done
Этап: 1

Миграция `0031_referral_program` по спеке, раздел «Схема»: таблицы
`referral_line_rates` (данные из двух колонок настроек; сами колонки
остаются до следующей миграции, схема их не объявляет),
`referral_tiers` + `referral_tier_rates`,
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

## Comments

**8 сентября 2026, сделано.** Миграция `0031_referral_program`
(`drizzle-kit generate` плюс data-миграция руками: две строки ставок из
настроек, ссылка «Основная» на каждого клиента; прежние колонки
остаются на выкатку — `clients.referral_code` nullable, схема их не
объявляет). Типы: `packages/types/src/referral.ts` — линии 1..5,
`referralLineWord`/`referralLineName`, вид кода, `promoCodeSchema` со
стоп-списком, `normalizeReferralCode`, предел кодов. Ядро:
`referral-program.ts` (программа, `effectiveReferralRates`, активные
рефералы, операции администратора с журналом), `referral-codes.ts`
(список, ссылка, промокод, архив с правилом последней ссылки, основной
код), `bonus-adjustments.ts`; `clients.ts` — цепочка до пятой линии
обходом по `referrer_id` в транзакции, код из таблицы любого вида,
`bindReferrerByPromoCode` с защитой от кольца; начисление по глубине и
старшинству; `getBonusAccount` отдаёт `lines[]` и `tier`;
`getClientCard` — `invitedByLine` и `referredVia`; сводка и справка
консьержа на N линий; `requireBps` переехал в `settings.ts`. Фикстуры
`givenReferralLines`, `givenReferralTier`; очистка тестовой базы
заводит две базовые ставки.

Тесты: `referral-program.test.ts` (глубина, углубление задним числом,
старшинство, уровень по активным, прошлое не меняется, журнал,
валидация), `referral-codes.test.ts` (коды, регистр, стоп-список,
предел, архив, приход по промокоду, привязка после регистрации с
четырьмя отказами), `bonus-adjustments.test.ts`; старые тесты
переведены на `updateReferralLines` и `lines[]`;
`register-client.test.ts` — цепочка до пятой линии.

Попутно: тесты воркера вебхуков держали точку отсчёта датой в кавычках
(`2026-09-07`), а пробная доставка встаёт в очередь на «сейчас» — 8
сентября забор по ней ничего не находил; точка теперь чуть впереди
часов машины.

Проверки: `pnpm typecheck` и полный `pnpm test` (14 пакетов) зелёные;
миграция прогнана на локальной базе разработки с двенадцатью
клиентами — двенадцать ссылок «Основная», две строки ставок, ни
одного клиента без кода. Перенос данных миграцией тестом не
закрепляется: база в тестах до миграции пуста.

По ревью (стандарты и спека): основной код клиенту без единой ссылки
заводится при первом чтении — окно выката между миграцией и
пересборкой Mini App; предел кодов и правило последней ссылки — под
замком строки клиента; кольцо ищется по предкам владельца кода, а не
по `referrals` (потомок глубже пятой линии); сводка не теряет линии
сверх глубины, по которым были начисления; тема журнала —
`referral_line_rates`; подсказка раздела «Рефералка» — про линии до
пятой и уровни.

Приложения адаптированы минимально, чтобы сборка была зелёной: панель
— «Экономика» без ставок линий, «Рефералка» на N линий, карточка —
приведено по линиям списком; Mini App — плашка линий по `lines[]`.
Экраны целиком — тикеты 03–05.
