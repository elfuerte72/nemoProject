import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
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
]);

export const staffRoleEnum = pgEnum('staff_role', ['manager', 'admin']);

export const currencyKindEnum = pgEnum('currency_kind', ['fiat', 'crypto']);

export const bonusTransactionKindEnum = pgEnum('bonus_transaction_kind', [
  'accrual', // начисление за исполненную заявку реферала
  'withdrawal', // списание при выплате
  'adjustment', // ручная правка администратором
]);

export const actorTypeEnum = pgEnum('actor_type', ['system', 'client', 'manager']);

/**
 * Настройки сервиса: единственная строка, `id` всегда 1.
 *
 * Синглтон, а не набор пар «ключ-значение», потому что каждая настройка
 * имеет свой тип и своё ограничение: ставка — целые базисные пункты в
 * разумных пределах, минимальная сумма вывода — денежная величина. В
 * таблице «ключ-значение» и то и другое стало бы текстом, а проверять
 * его пришлось бы в коде.
 *
 * Значения по умолчанию — заглушки: конкретные ставки и минимальная
 * сумма вывода зависят от блокеров B1 и B3 и заполняются администратором
 * через экран настроек (тикет 14).
 *
 * «Ставка» здесь — доля реферального вознаграждения, и так её называют
 * и ТЗ, и спека. `CONTEXT.md` запрещает это слово в другом значении —
 * как синоним предварительного курса.
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
 * Сохранённые реквизиты клиента — куда менеджер отправляет деньги.
 * Полный номер лежит только в зашифрованном виде (docs/adr/0002);
 * `card_last4` открыт, чтобы клиент узнавал свою карту в списке.
 */
export const clientRequisites = pgTable(
  'client_requisites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: bigint('client_id', { mode: 'bigint' })
      .notNull()
      .references(() => clients.telegramUserId, { onDelete: 'cascade' }),
    bankName: text('bank_name'),
    phone: text('phone'),
    cardLast4: text('card_last4'),
    cardSealed: bytea('card_sealed'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [index('client_requisites_client_idx').on(table.clientId)],
);

/** Справочник валют. Наполняется после ответа на блокер C1. */
export const currencies = pgTable('currencies', {
  code: text('code').primaryKey(),
  decimals: smallint('decimals').notNull(),
  kind: currencyKindEnum('kind').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
});

/**
 * Валютное направление и наценка по нему. Наценка — правило в базисных
 * пунктах (100 bps = 1%), задаётся администратором.
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
    markupBps: integer('markup_bps').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
  },
  (table) => [
    unique('currency_pairs_direction').on(table.fromCode, table.toCode, table.kind),
    check('currency_pairs_markup_non_negative', sql`${table.markupBps} >= 0`),
  ],
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
    preliminaryRate: money('preliminary_rate'),
    finalRate: money('final_rate'),
    serviceIncome: money('service_income'),
    serviceIncomeCode: text('service_income_code'),
    status: exchangeRequestStatusEnum('status').default('new').notNull(),
    assignedManagerId: uuid('assigned_manager_id').references(() => staff.id),
    requisitesId: uuid('requisites_id').references(() => clientRequisites.id),
    /**
     * Куда клиенту платить. Диктуется менеджером вместе с финальным
     * курсом и хранится в заявке, а не только в сообщении бота: клиент
     * возвращается к ней через день и не должен искать сообщение в
     * переписке.
     */
    paymentInstructions: text('payment_instructions'),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('exchange_requests_client_idx').on(table.clientId),
    index('exchange_requests_status_idx').on(table.status),
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
    withdrawalRequestId: uuid('withdrawal_request_id'),
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
    destinationSealed: bytea('destination_sealed'),
    destinationHint: text('destination_hint'),
    status: withdrawalRequestStatusEnum('status').default('new').notNull(),
    managerId: uuid('manager_id'),
    rejectReason: text('reject_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (table) => [index('withdrawal_requests_status_idx').on(table.status)],
);

/**
 * Заявка на европейскую карту. Сервис карту не выпускает — статус
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
export const staff = pgTable('staff', {
  id: uuid('id').defaultRandom().primaryKey(),
  telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }).notNull().unique(),
  displayName: text('display_name').notNull(),
  role: staffRoleEnum('role').default('manager').notNull(),
  totpSecretSealed: bytea('totp_secret_sealed'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Журнал доступа к расшифрованным реквизитам (docs/adr/0002). Только
 * добавление: восстановить задним числом, кто и когда видел номер карты,
 * иначе невозможно.
 */
export const requisiteAccessLog = pgTable(
  'requisite_access_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    requisitesId: uuid('requisites_id')
      .notNull()
      .references(() => clientRequisites.id),
    exchangeRequestId: uuid('exchange_request_id').references(() => exchangeRequests.id),
    accessedAt: timestamp('accessed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('requisite_access_log_staff_idx').on(table.staffId),
    index('requisite_access_log_requisites_idx').on(table.requisitesId),
  ],
);
