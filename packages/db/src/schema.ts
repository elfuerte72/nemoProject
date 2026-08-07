import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Схема базы. Русские названия сущностей — в `CONTEXT.md`; здесь их
 * машинные соответствия.
 *
 * Все денежные величины и курсы — `numeric(38, 18)`, драйвер отдаёт их
 * строкой и арифметика идёт через `Money` из `@nemo/types`. Причина —
 * в комментарии к типу `Amount`: целочисленное хранение в минорных
 * единицах переполняется на криптовалютах с 18 знаками.
 */

/** Зашифрованный конверт из `@nemo/crypto`. Прочитать может только админка. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * Денежная колонка. Точность 38 при масштабе 18 покрывает и фиат с двумя
 * знаками, и wei с восемнадцатью; драйвер отдаёт значение строкой, чтобы
 * оно не проходило через `number` и не теряло точность.
 */
const money = (name: string) => numeric(name, { precision: 38, scale: 18 });

export const exchangeKindEnum = pgEnum('exchange_kind', ['electronic', 'cash']);

export const exchangeRequestStatusEnum = pgEnum('exchange_request_status', [
  'new',
  'in_progress',
  'rate_confirmed',
  'payment_received',
  'completed',
  'cancelled',
]);

export const withdrawalRequestStatusEnum = pgEnum('withdrawal_request_status', [
  'new',
  'approved',
  'paid',
  'rejected',
]);

export const withdrawalMethodEnum = pgEnum('withdrawal_method', ['bank', 'crypto']);

export const cardApplicationStatusEnum = pgEnum('card_application_status', [
  'submitted',
  'processing',
  'active',
  'rejected',
  'cancelled',
]);

export const staffRoleEnum = pgEnum('staff_role', ['manager', 'admin']);

export const currencyKindEnum = pgEnum('currency_kind', ['fiat', 'crypto']);

/** Способ, которым клиент получает деньги. Русские названия — в `CONTEXT.md`. */
export const requisiteKindEnum = pgEnum('requisite_kind', ['phone', 'card', 'wallet']);

export const bonusTransactionKindEnum = pgEnum('bonus_transaction_kind', [
  'accrual', // начисление за исполненную заявку реферала
  'withdrawal', // списание при выплате
  'adjustment', // ручная правка администратором
]);

export const actorTypeEnum = pgEnum('actor_type', ['system', 'client', 'manager']);

/** Кто кому написал. Лента одна на клиента, и направление — её единственная ось. */
export const messageDirectionEnum = pgEnum('message_direction', ['incoming', 'outgoing']);

/**
 * О чём просьба, пришедшая из раздела «За границей».
 *
 * Перечислением, а не свободным текстом: тем ровно столько, сколько
 * пунктов в разделе, и новая заводится вместе с пунктом — то есть
 * миграцией, а не строкой, набранной в запросе.
 *
 * Подписки сюда не попадают: их ведёт партнёр, и обращения у нас они не
 * создают. Заявка на карту — тоже: у неё свои состояния, и поддержка
 * ей не нужна.
 */
export const inquiryTopicEnum = pgEnum('inquiry_topic', ['hotel', 'purchase']);

/**
 * Настройки сервиса: единственная строка, `id` всегда 1.
 *
 * Синглтон, а не набор пар «ключ-значение», потому что каждая настройка
 * имеет свой тип и своё ограничение: ставка — целые базисные пункты в
 * разумных пределах, минимальная сумма вывода — денежная величина. В
 * таблице «ключ-значение» и то и другое стало бы текстом, а проверять
 * его пришлось бы в коде.
 *
 * Здесь же — всё, что определяет экономику сервиса: наценка,
 * минимальная сумма обмена, срок жизни неоплаченной заявки. Константы,
 * определяющие деньги, в коде не остаются: администратор меняет их из
 * панели, а не выкаткой.
 *
 * Значения по умолчанию — заглушки: конкретные ставки и суммы зависят
 * от блокеров B1 и B3 и заполняются администратором через экран
 * настроек.
 *
 * «Ставка линии» — термин из `CONTEXT.md`: доля дохода по заявке,
 * начисляемая рефереру. Со «ставкой» как синонимом курса, которую тот
 * же словарь запрещает, общего у неё только слово.
 */
export const serviceSettings = pgTable(
  'service_settings',
  {
    id: smallint('id').primaryKey().default(1),
    /** Ставка первой линии в базисных пунктах: 100 bps = 1%. */
    referralLine1Bps: integer('referral_line1_bps').default(500).notNull(),
    /** Ставка второй линии в базисных пунктах. */
    referralLine2Bps: integer('referral_line2_bps').default(200).notNull(),
    /** Ниже этой суммы заявка на вывод не принимается. */
    minWithdrawalAmount: money('min_withdrawal_amount').default('1000').notNull(),
    /**
     * Наценка к котировке в базисных пунктах — одна на весь сервис.
     *
     * Была свойством направления, стала настройкой: при двух зеркальных
     * направлениях восемь полей давали одно и то же число, а разная
     * наценка на покупку и продажу сознательно не делается. Вернуть её
     * по направлениям можно миграцией, когда появится повод.
     */
    markupBps: integer('markup_bps').default(200).notNull(),
    /**
     * Ниже этой суммы заявка на обмен не принимается: при наценке в пару
     * процентов мелкий обмен не покрывает комиссию сети, которую платит
     * сервис.
     *
     * В USDT — эту валюту клиент отдаёт или получает в каждом
     * направлении, и порог поэтому действует на весь справочник целиком
     * (`MIN_EXCHANGE_CODE`). Раньше был в рублях, пока рубль стоял по
     * одну сторону каждой пары.
     */
    minExchangeAmount: money('min_exchange_amount').default('35').notNull(),
    /**
     * Сколько заявка ждёт оплаты после того, как менеджер выдал
     * реквизиты. Курс заявки — обязательство сервиса, и бессрочным оно
     * быть не может: клиент вернулся бы к нему тогда, когда рынок ушёл
     * в его пользу.
     */
    unpaidExchangeRequestTtlMinutes: integer('unpaid_exchange_request_ttl_minutes').default(120).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('service_settings_singleton', sql`${table.id} = 1`),
    // Ставка выше 100% отдавала бы рефереру больше, чем сервис заработал.
    check(
      'service_settings_line1_range',
      sql`${table.referralLine1Bps} between 0 and 10000`,
    ),
    check(
      'service_settings_line2_range',
      sql`${table.referralLine2Bps} between 0 and 10000`,
    ),
    check('service_settings_min_withdrawal_non_negative', sql`${table.minWithdrawalAmount} >= 0`),
    // Наценка в 100% означала бы курс, по которому клиент не получает
    // ничего: это не настройка доходности, а опечатка.
    check('service_settings_markup_range', sql`${table.markupBps} between 0 and 10000`),
    check('service_settings_min_exchange_non_negative', sql`${table.minExchangeAmount} >= 0`),
    // Нулевой срок отменял бы заявку в тот же миг, когда менеджер выдал
    // реквизиты, — то есть закрывал бы сервис.
    check('service_settings_ttl_positive', sql`${table.unpaidExchangeRequestTtlMinutes} > 0`),
  ],
);

/**
 * Клиент. Ключ — `telegram_user_id`, а не username: username в Telegram
 * изменяем и переиспользуется другими людьми (принцип 2.2 ТЗ).
 */
export const clients = pgTable(
  'clients',
  {
    telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }).primaryKey(),
    username: text('username'),
    phone: text('phone'),
    marketingConsent: boolean('marketing_consent').default(false).notNull(),
    /**
     * Когда клиент ответил на вопрос о рассылке. Пусто — не ответил, и
     * спросить нужно снова: без этой отметки «нет согласия» и «не
     * спрашивали» неразличимы, и закрывший приложение до ответа не
     * увидел бы вопроса больше никогда.
     */
    marketingConsentAskedAt: timestamp('marketing_consent_asked_at', {
      withTimezone: true,
    }),
    referrerId: bigint('referrer_id', { mode: 'bigint' }),
    referralCode: text('referral_code').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('clients_referrer_idx').on(table.referrerId),
    check(
      'clients_no_self_referral',
      sql`${table.referrerId} is null or ${table.referrerId} <> ${table.telegramUserId}`,
    ),
  ],
);

/**
 * Справочник сетей перевода.
 *
 * По образцу справочника валют: код и признак активности. Общий для
 * реквизитов обмена и заявок на вывод — двух разных правд о том, куда
 * сервис умеет отправлять, не существует, иначе появится заявка,
 * которую нельзя исполнить.
 *
 * Гасит сеть администратор — тогда, когда кошелёк в ней временно
 * недоступен. Строки не удаляются: на них ссылаются прошлые заявки.
 */
export const transferNetworks = pgTable('transfer_networks', {
  code: text('code').primaryKey(),
  isActive: boolean('is_active').default(true).notNull(),
});

/**
 * Заготовки текста: реквизиты сервиса для оплаты и тексты, которые
 * читает клиент.
 *
 * Отдельной таблицей, а не колонками настроек: это не скаляры со своими
 * ограничениями, а произвольный текст, и колонка под каждый означала бы
 * миграцию на каждую новую формулировку.
 *
 * Пустая таблица — рабочее состояние: значения по умолчанию лежат в
 * коде, и первый запуск не требует ручного заполнения.
 */
export const textTemplates = pgTable('text_templates', {
  key: text('key').primaryKey(),
  body: text('body').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Сохранённые реквизиты клиента — куда менеджер отправляет деньги.
 *
 * Запись описывает один способ получения целиком, а не набор
 * необязательных полей: реквизита, по которому нельзя отправить деньги,
 * не существует. Что обязательно внутри типа, проверяет ограничение
 * ниже — форма всего лишь не даёт составить неполную запись раньше него.
 *
 * Полный номер карты и адрес кошелька лежат только в зашифрованном виде
 * (docs/adr/0002); открыты `card_last4` и `address_hint` — по ним клиент
 * узнаёт свою запись в списке, не видя её целиком.
 */
export const clientRequisites = pgTable(
  'client_requisites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: bigint('client_id', { mode: 'bigint' })
      .notNull()
      .references(() => clients.telegramUserId, { onDelete: 'cascade' }),
    kind: requisiteKindEnum('kind').notNull(),
    bankName: text('bank_name'),
    phone: text('phone'),
    cardLast4: text('card_last4'),
    cardSealed: bytea('card_sealed'),
    /** Сеть кошелька. Ошибка сети необратима, поэтому она из справочника. */
    network: text('network').references(() => transferNetworks.code),
    addressSealed: bytea('address_sealed'),
    /** Начало и конец адреса: всё, что видно о кошельке без расшифровки. */
    addressHint: text('address_hint'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('client_requisites_client_idx').on(table.clientId),
    /*
     * Набор полей определяется типом, и проверяет это база, а не только
     * форма: форма — не единственный способ создать запись, а
     * последствие у чужого поля одно — сеть у карты или номер карты у
     * кошелька означают перевод не туда, откуда не возвращаются.
     *
     * Архивные записи из проверки исключены. Архив — свидетельство
     * того, куда деньги ушли тогда; требовать от него полноты
     * сегодняшних правил значило бы переписывать историю, а записи, по
     * которой ещё можно отправить деньги, архив не содержит по
     * определению.
     */
    check(
      'client_requisites_fields_by_kind',
      sql`${table.archivedAt} is not null or case ${table.kind}
        when 'phone' then ${table.bankName} is not null and ${table.phone} is not null
          and ${table.cardLast4} is null and ${table.cardSealed} is null
          and ${table.network} is null and ${table.addressSealed} is null
          and ${table.addressHint} is null
        when 'card' then ${table.bankName} is not null and ${table.cardLast4} is not null
          and ${table.cardSealed} is not null and ${table.phone} is null
          and ${table.network} is null and ${table.addressSealed} is null
          and ${table.addressHint} is null
        when 'wallet' then ${table.network} is not null and ${table.addressSealed} is not null
          and ${table.addressHint} is not null and ${table.bankName} is null
          and ${table.phone} is null and ${table.cardLast4} is null
          and ${table.cardSealed} is null
      end`,
    ),
  ],
);

/**
 * Счета сервиса: куда клиент отправляет оплату (docs/adr/0008).
 *
 * Устроены как реквизиты клиента и по той же причине: запись описывает
 * один способ приёма целиком, а набор полей внутри способа держит
 * ограничение, а не форма. Отличий от клиентской записи два — валюта,
 * в которой на этот счёт принимают, и получатель: переводя по номеру
 * телефона, клиент сверяет имя, которое показал ему банк.
 *
 * Номер карты и адрес кошелька шифруются тем же ключом, что и
 * клиентские. Не потому, что клиентский деплой не должен их прочитать —
 * эти реквизиты сервис сам рассылает клиентам, — а потому, что два
 * разных правила хранения для соседних строк однажды разойдутся.
 *
 * Строки не удаляются: на них ссылаются заявки, которым этот счёт
 * выдали. Гашение — признак `is_active`, и на выданное оно не влияет.
 */
export const serviceAccounts = pgTable(
  'service_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: requisiteKindEnum('kind').notNull(),
    /** Валюта, которой на этот счёт платят: счёт не в той до менеджера не доходит. */
    currencyCode: text('currency_code')
      .notNull()
      .references(() => currencies.code),
    bankName: text('bank_name'),
    /** Кому уходит перевод. Клиент сверяет имя с тем, что показал банк. */
    holderName: text('holder_name'),
    phone: text('phone'),
    cardLast4: text('card_last4'),
    cardSealed: bytea('card_sealed'),
    network: text('network').references(() => transferNetworks.code),
    addressSealed: bytea('address_sealed'),
    addressHint: text('address_hint'),
    /** Заметка менеджеру: чем этот счёт отличается от соседнего. */
    note: text('note'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('service_accounts_currency_idx').on(table.currencyCode, table.isActive),
    /*
     * Правило то же, что у реквизитов клиента: чужое поле внутри
     * способа означает перевод не туда. Погашенные из проверки не
     * исключаются — в отличие от архивных клиентских записей: счёт
     * гасят и включают обратно, и неполный он к тому времени останется
     * неполным.
     */
    check(
      'service_accounts_fields_by_kind',
      sql`case ${table.kind}
        when 'phone' then ${table.bankName} is not null and ${table.holderName} is not null
          and ${table.phone} is not null
          and ${table.cardLast4} is null and ${table.cardSealed} is null
          and ${table.network} is null and ${table.addressSealed} is null
          and ${table.addressHint} is null
        when 'card' then ${table.bankName} is not null and ${table.holderName} is not null
          and ${table.cardLast4} is not null and ${table.cardSealed} is not null
          and ${table.phone} is null
          and ${table.network} is null and ${table.addressSealed} is null
          and ${table.addressHint} is null
        when 'wallet' then ${table.network} is not null and ${table.addressSealed} is not null
          and ${table.addressHint} is not null and ${table.bankName} is null
          and ${table.holderName} is null
          and ${table.phone} is null and ${table.cardLast4} is null
          and ${table.cardSealed} is null
      end`,
    ),
  ],
);

/** Справочник валют. Наполняется после ответа на блокер C1. */
export const currencies = pgTable('currencies', {
  code: text('code').primaryKey(),
  decimals: smallint('decimals').notNull(),
  kind: currencyKindEnum('kind').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
});

/**
 * Валютное направление: пара валют плюс способ исполнения. Направление
 * одностороннее — «отдаю USDT, получаю рубли» и обратное хранятся
 * отдельными строками.
 *
 * Наценки здесь нет: она одна на весь сервис и живёт в его настройках.
 * Восемь полей, из которых работали два, администратор правил по
 * одному, а результат складывался в одно число.
 */
export const currencyPairs = pgTable(
  'currency_pairs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fromCode: text('from_code')
      .notNull()
      .references(() => currencies.code),
    toCode: text('to_code')
      .notNull()
      .references(() => currencies.code),
    kind: exchangeKindEnum('kind').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
  },
  (table) => [unique('currency_pairs_direction').on(table.fromCode, table.toCode, table.kind)],
);

/**
 * Заявка на обмен. `service_income` — доход по заявке, база реферальных
 * начислений (docs/adr/0003); заполняется при переходе в `completed`.
 */
export const exchangeRequests = pgTable(
  'exchange_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: bigint('client_id', { mode: 'bigint' })
      .notNull()
      .references(() => clients.telegramUserId),
    kind: exchangeKindEnum('kind').notNull(),
    fromCode: text('from_code').notNull(),
    toCode: text('to_code').notNull(),
    fromAmount: money('from_amount').notNull(),
    toAmount: money('to_amount'),
    /**
     * Курс, по которому клиент подал заявку, — обязательство сервиса, а
     * не справка. Называлось предварительным курсом, пока курс им и был;
     * название, которое врёт, хуже отсутствующего.
     *
     * Пусто у наличной заявки — котировок наличного рынка у сервиса нет
     * — и у безналичной, поданной при молчащем источнике котировок:
     * такая ведёт себя как наличная, курс ей назовёт менеджер.
     */
    requestRate: money('request_rate'),
    finalRate: money('final_rate'),
    serviceIncome: money('service_income'),
    serviceIncomeCode: text('service_income_code'),
    status: exchangeRequestStatusEnum('status').default('new').notNull(),
    assignedManagerId: uuid('assigned_manager_id').references(() => staff.id),
    requisitesId: uuid('requisites_id').references(() => clientRequisites.id),
    /**
     * Куда клиенту платить. Называется менеджером и хранится в заявке,
     * а не только в сообщении бота: клиент возвращается к ней через
     * день и не должен искать сообщение в переписке.
     */
    paymentInstructions: text('payment_instructions'),
    /**
     * Какой счёт сервиса выдали по этой заявке (docs/adr/0008).
     *
     * Ссылкой, а не копией: погашение счёта прошлых заявок не касается,
     * а вопрос «куда клиенту сказали платить» должен иметь ответ, не
     * зависящий от того, что со счётом стало потом. Само выданное
     * остаётся текстом рядом: клиент читает то, что ему отправили.
     */
    serviceAccountId: uuid('service_account_id').references(() => serviceAccounts.id),
    /**
     * Когда менеджер выдал реквизиты — то есть когда клиент впервые мог
     * заплатить. От этого момента считается срок жизни неоплаченной
     * заявки.
     *
     * Отдельным полем, а не вычислением из истории переходов: истечение
     * обязательства не должно зависеть от полноты журнала. Отсчёт от
     * подачи был бы наказанием клиента за то, что смена спала.
     */
    requisitesIssuedAt: timestamp('requisites_issued_at', { withTimezone: true }),
    /**
     * Когда клиенту ушло предупреждение о скором истечении. Хранится
     * ради однократности: без отметки каждый прогон присылал бы его
     * заново.
     */
    expiryWarnedAt: timestamp('expiry_warned_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('exchange_requests_client_idx').on(table.clientId),
    /*
     * Очередь читается состоянием и упорядочена по времени подачи, и
     * страницу отдаёт курсор по паре «время, идентификатор» — то есть
     * по этому индексу целиком. Одного состояния мало: на нём выборка
     * сортировала бы всё найденное заново при каждой подгрузке.
     */
    index('exchange_requests_status_created_idx').on(
      table.status,
      table.createdAt,
      table.id,
    ),
    /**
     * «Что моё» — первый вопрос смены, и спрашивается он не реже
     * очереди. Идентификатор в хвосте по той же причине, что и выше:
     * порядок выборки — пара «время, идентификатор», и без него
     * сортировка считается заново.
     */
    index('exchange_requests_manager_idx').on(
      table.assignedManagerId,
      table.createdAt,
      table.id,
    ),
    check(
      'exchange_requests_income_on_completion',
      sql`${table.status} <> 'completed' or ${table.serviceIncome} is not null`,
    ),
  ],
);

/**
 * История смены статусов заявки. Только добавление: понадобится и для
 * разбора спорных сделок, и для оценки работы менеджеров.
 */
export const exchangeRequestEvents = pgTable(
  'exchange_request_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => exchangeRequests.id, { onDelete: 'cascade' }),
    fromStatus: exchangeRequestStatusEnum('from_status'),
    toStatus: exchangeRequestStatusEnum('to_status').notNull(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorStaffId: uuid('actor_staff_id'),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('exchange_request_events_request_idx').on(table.requestId)],
);

/**
 * Реферальные связи обеих линий, развёрнутые явно: строка первой линии
 * создаётся при регистрации по ссылке, строка второй — когда реферал
 * приводит своего. Глубже второй линии связи не пишутся.
 */
export const referrals = pgTable(
  'referrals',
  {
    referrerId: bigint('referrer_id', { mode: 'bigint' })
      .notNull()
      .references(() => clients.telegramUserId, { onDelete: 'cascade' }),
    referralId: bigint('referral_id', { mode: 'bigint' })
      .notNull()
      .references(() => clients.telegramUserId, { onDelete: 'cascade' }),
    line: smallint('line').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.referrerId, table.referralId] }),
    index('referrals_referral_idx').on(table.referralId),
    check('referrals_line_range', sql`${table.line} in (1, 2)`),
    check('referrals_not_self', sql`${table.referrerId} <> ${table.referralId}`),
  ],
);

/**
 * Движение бонусных баллов. Баланс клиента — сумма его строк, отдельного
 * поля с балансом нет: денежный остаток, который можно рассинхронизировать
 * с историей, рано или поздно расходится с ней.
 */
export const bonusTransactions = pgTable(
  'bonus_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: bigint('client_id', { mode: 'bigint' })
      .notNull()
      .references(() => clients.telegramUserId, { onDelete: 'cascade' }),
    kind: bonusTransactionKindEnum('kind').notNull(),
    amount: money('amount').notNull(),
    line: smallint('line'),
    rateBps: integer('rate_bps'),
    exchangeRequestId: uuid('exchange_request_id').references(() => exchangeRequests.id),
    withdrawalRequestId: uuid('withdrawal_request_id').references(
      () => withdrawalRequests.id,
    ),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('bonus_transactions_client_idx').on(table.clientId),
    unique('bonus_transactions_one_accrual_per_line').on(
      table.exchangeRequestId,
      table.clientId,
      table.line,
    ),
    // Одна выплата — одно списание. Повторная отметка о выплате
    // списала бы баллы дважды, а заметно это стало бы только по жалобе
    // клиента: у начислений от такого защищает ограничение выше, и у
    // списаний оно должно быть не слабее.
    unique('bonus_transactions_one_payout_per_withdrawal').on(table.withdrawalRequestId),
  ],
);

/** Заявка на вывод бонусных баллов. Исполняет менеджер вручную. */
export const withdrawalRequests = pgTable(
  'withdrawal_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: bigint('client_id', { mode: 'bigint' })
      .notNull()
      .references(() => clients.telegramUserId),
    amount: money('amount').notNull(),
    method: withdrawalMethodEnum('method').notNull(),
    /**
     * Сеть перевода. Только у выплат в криптовалюте: у банковского счёта
     * её нет, и «TRC20» рядом с номером карты означал бы ошибку ввода.
     *
     * Ссылкой на общий справочник: сеть, в которую сервис не умеет
     * отправлять, не должна попадать в заявку ни отсюда, ни из
     * реквизитов обмена.
     */
    network: text('network').references(() => transferNetworks.code),
    /**
     * Куда перечислить выплату — записью из списка реквизитов клиента.
     *
     * Список тот же, из которого выбирают при обмене: двух правд о том,
     * куда сервису слать клиенту деньги, не бывает. Раньше реквизит
     * вводился заново прямо в форме вывода и ложился сюда отдельным
     * шифротекстом — так сделаны заявки, поданные до этого; переписать
     * их нечем, записи-реквизита у них не было.
     */
    requisitesId: uuid('requisites_id').references(() => clientRequisites.id),
    destinationSealed: bytea('destination_sealed'),
    destinationHint: text('destination_hint'),
    status: withdrawalRequestStatusEnum('status').default('new').notNull(),
    managerId: uuid('manager_id').references((): AnyPgColumn => staff.id),
    rejectReason: text('reject_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (table) => [
    index('withdrawal_requests_status_idx').on(table.status),
    index('withdrawal_requests_client_idx').on(table.clientId),
    check('withdrawal_requests_amount_positive', sql`${table.amount} > 0`),
    // Отказ без причины оставляет клиента гадать, что исправить.
    check(
      'withdrawal_requests_reject_reason',
      sql`${table.status} <> 'rejected' or ${table.rejectReason} is not null`,
    ),
    // Криптоперевод без сети отправить некуда: один и тот же адрес живёт
    // в нескольких, и выбор наугад — потерянные деньги.
    check(
      'withdrawal_requests_crypto_network',
      sql`${table.method} <> 'crypto' or ${table.network} is not null`,
    ),
    /*
     * Куда платить — либо запись из списка клиента, либо собственный
     * шифротекст заявки. Одно из двух, и хотя бы одно: заявка на выплату,
     * из которой не видно, куда платить, доходит до менеджера и встаёт.
     *
     * Оба разом тоже нельзя: два ответа на один вопрос означают, что
     * однажды выплату сделают не по тому.
     */
    check(
      'withdrawal_requests_destination',
      sql`(case when ${table.requisitesId} is not null then 1 else 0 end
        + case when ${table.destinationSealed} is not null then 1 else 0 end) = 1`,
    ),
  ],
);

/**
 * Заявка на виртуальную карту. Сервис карту не выпускает — статус
 * отражает то, что сообщил внешний провайдер (docs/adr/0004).
 */
export const cardApplications = pgTable(
  'card_applications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: bigint('client_id', { mode: 'bigint' })
      .notNull()
      .references(() => clients.telegramUserId),
    status: cardApplicationStatusEnum('status').default('submitted').notNull(),
    providerReference: text('provider_reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('card_applications_client_idx').on(table.clientId)],
);

/**
 * Сотрудник. Вход в админку — Telegram Login, допуск только для
 * `telegram_user_id` из этой таблицы, плюс одноразовый код.
 */
export const staff = pgTable(
  'staff',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }).notNull().unique(),
    displayName: text('display_name').notNull(),
    role: staffRoleEnum('role').default('manager').notNull(),
    totpSecretSealed: bytea('totp_secret_sealed'),
    /**
     * Когда выданным ключом впервые вошли. Пусто — ключ выдан, но до
     * приложения-аутентификатора не доехал, и вход показывает его сам:
     * код для камеры и строку. Ставится при первом сошедшемся коде и
     * закрывает этот показ навсегда — иначе получилось бы не «выдать
     * ключ забывшему его», а «отдать второй фактор любому, кто открыл
     * вход».
     */
    secondFactorConfirmedAt: timestamp('second_factor_confirmed_at', { withTimezone: true }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    /*
     * «Ключа нет, но им уже входили» — состояние, которого не бывает:
     * отметку ставит только сошедшийся код, а он берётся из ключа.
     * Правило держит база: снять секрет и оставить отметку — это ровно
     * тот случай, когда вход перестанет показывать ключ, которого нет,
     * и сотрудник упрётся в поле для кода. С этого и начиналось.
     */
    check(
      'staff_second_factor_confirmed_needs_secret',
      sql`${table.secondFactorConfirmedAt} is null or ${table.totpSecretSealed} is not null`,
    ),
  ],
);

/**
 * Журнал изменений настроек сервиса.
 *
 * Только добавление. Ставки линий и наценки — это деньги: и клиента, и
 * сервиса, — и вопрос «почему за эту заявку начислили столько» должен
 * иметь ответ, а не догадку.
 *
 * Что именно изменилось, хранится документом, а не колонками: настройки
 * разнородны — ставка в базисных пунктах, минимальная сумма вывода,
 * роль сотрудника, наценка направления, — и колонка под каждую
 * означала бы правку схемы при каждой новой настройке.
 */
export const settingsAuditLog = pgTable(
  'settings_audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    /** Что настраивали: `service_settings`, `currency_pair`, `staff`. */
    subject: text('subject').notNull(),
    /** Идентификатор направления или сотрудника; у настроек сервиса пуст. */
    subjectId: text('subject_id'),
    changes: jsonb('changes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('settings_audit_log_created_idx').on(table.createdAt)],
);

/**
 * Ручная рассылка клиентам, давшим согласие.
 *
 * Результат отправки хранится, а не только показывается: администратор
 * возвращается к вопросу «дошло ли до людей письмо на прошлой неделе»
 * тогда, когда экран отправки давно закрыт.
 */
export const broadcasts = pgTable('broadcasts', {
  id: uuid('id').defaultRandom().primaryKey(),
  authorStaffId: uuid('author_staff_id')
    .notNull()
    .references(() => staff.id),
  body: text('body').notNull(),
  /** Скольким согласившимся предназначалась рассылка. */
  recipients: integer('recipients').default(0).notNull(),
  delivered: integer('delivered').default(0).notNull(),
  failed: integer('failed').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

/**
 * Переписка клиента с менеджером.
 *
 * Лента одна на клиента: тредов по заявкам нет, потому что у клиента в
 * Telegram одно окно, и тред существовал бы только на стороне менеджера.
 * Сообщение может ссылаться на заявку — так работает кнопка «написать»
 * из карточки, — но лента остаётся общей.
 *
 * Клиент здесь ссылка на строку клиента, а не текст и не имя: по ней и
 * собирается лента, и проверяется, чья она.
 *
 * Отдельного поля «клиент не отвечен» нет: неотвеченным считается тот,
 * у кого последнее сообщение входящее. Поле состояния пришлось бы
 * поддерживать в согласии с самой лентой, а расходится оно молча.
 */
export const clientMessages = pgTable(
  'client_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /**
     * Порядок в ленте. Время создания два сообщения, вставленные в одну
     * миллисекунду, не разводит, а от порядка зависит, считается клиент
     * отвеченным или нет.
     */
    seq: bigserial('seq', { mode: 'bigint' }).notNull().unique(),
    clientId: bigint('client_id', { mode: 'bigint' })
      .notNull()
      .references(() => clients.telegramUserId, { onDelete: 'cascade' }),
    direction: messageDirectionEnum('direction').notNull(),
    /**
     * О чём просьба, если это просьба. Пусто у обычного вопроса: тему
     * называет тот, кто пришёл из раздела «За границей», а спросивший
     * курс ничего не выбирал.
     *
     * Отдельной колонкой, а не префиксом текста: по префиксу тему
     * пришлось бы разбирать, а это правда, живущая в форматировании, и
     * рассыпается она от первой правки формулировки.
     */
    topic: inquiryTopicEnum('topic'),
    body: text('body'),
    /**
     * Вложение — идентификатор файла у Telegram, а не сам файл. На
     * дисках сервиса чужих номеров карт не появляется; панель
     * подтягивает изображение по требованию.
     */
    attachmentFileId: text('attachment_file_id'),
    /** Кто из сотрудников ответил. Только у исходящих. */
    authorStaffId: uuid('author_staff_id').references(() => staff.id),
    exchangeRequestId: uuid('exchange_request_id').references(() => exchangeRequests.id),
    /**
     * Когда клиенту ушло подтверждение приёма. Ставится условно и
     * однажды на череду сообщений: два сообщения подряд не должны дать
     * два одинаковых ответа.
     */
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    /** Когда об обращении сообщили сотрудникам. */
    staffNotifiedAt: timestamp('staff_notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('client_messages_client_idx').on(table.clientId, table.seq),
    /*
     * Под отбор разговоров по теме: менеджер спрашивает «где просьбы про
     * деньги», и выборка идёт по теме внутри ленты клиента.
     */
    index('client_messages_topic_idx').on(table.topic, table.clientId),
    // Автор есть ровно у исходящего: у входящего им был бы клиент, а он
    // и так записан ссылкой.
    check(
      'client_messages_author_for_outgoing',
      sql`(${table.direction} = 'outgoing') = (${table.authorStaffId} is not null)`,
    ),
    // Сообщение без содержимого не сообщение: в ленте оно выглядит
    // потерянной строкой, и разбираться в ней будет менеджер. Пустую
    // строку вместо текста отсекает операция — база ловит то, что
    // прошло бы мимо неё: прямую вставку в обход прикладного слоя.
    check(
      'client_messages_not_empty',
      sql`${table.body} is not null or ${table.attachmentFileId} is not null`,
    ),
  ],
);

/**
 * Журнал доступа к расшифрованным реквизитам (docs/adr/0002). Только
 * добавление: восстановить задним числом, кто и когда видел номер карты,
 * иначе невозможно.
 *
 * Реквизит бывает двух родов — сохранённая карта клиента и счёт, на
 * который он попросил выплатить баллы, — поэтому обе ссылки
 * необязательны, а проверка требует ровно одну. Общий журнал, а не два:
 * администратор спрашивает «что этот сотрудник видел», а не «что он
 * видел в разделе выплат».
 */
export const requisiteAccessLog = pgTable(
  'requisite_access_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    requisitesId: uuid('requisites_id').references(() => clientRequisites.id),
    exchangeRequestId: uuid('exchange_request_id').references(() => exchangeRequests.id),
    withdrawalRequestId: uuid('withdrawal_request_id').references(
      () => withdrawalRequests.id,
    ),
    /**
     * Вложение, присланное клиентом. Такой же чувствительный документ,
     * как номер карты: на скриншоте перевода видно и счёт, и имя.
     */
    messageId: uuid('message_id').references(() => clientMessages.id),
    /** Чьи реквизиты открывали. Хранится явно: ссылка бывает разной. */
    clientId: bigint('client_id', { mode: 'bigint' })
      .notNull()
      .references(() => clients.telegramUserId),
    accessedAt: timestamp('accessed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('requisite_access_log_staff_idx').on(table.staffId),
    index('requisite_access_log_requisites_idx').on(table.requisitesId),
    index('requisite_access_log_client_idx').on(table.clientId),
    // Запись без предмета не отвечает на вопрос, ради которого журнал
    // ведётся: что именно сотрудник открыл. Предмет ровно один: две
    // ссылки в одной строке означали бы два обращения, слитых в одно.
    check(
      'requisite_access_log_subject',
      sql`(case when ${table.requisitesId} is not null then 1 else 0 end
        + case when ${table.withdrawalRequestId} is not null then 1 else 0 end
        + case when ${table.messageId} is not null then 1 else 0 end) = 1`,
    ),
  ],
);
