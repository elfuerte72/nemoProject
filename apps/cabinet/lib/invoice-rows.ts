import { Money, type Amount } from '@nemo/types';
import { formatMoney, formatRate } from '@nemo/ui/format';
import type { MoneyLine } from '@nemo/ui/money-list';
import type { PillTone } from './labels';

/**
 * Счёт и возврат POS-терминала — макет без денег.
 *
 * Сущностей в ядре у них нет и пока не будет (`backlog.md`, решение от
 * 10 сентября 2026): за счётом у образца стоит приём денег покупателя,
 * а Tobee их не принимает. Здесь только то, из чего собран экран:
 * состояния, набор колонок и ячейки под них.
 *
 * Набор колонок — в одном месте, и шапка со строками берут его отсюда:
 * подпись, разъехавшаяся со своим столбцом, обнаруживается глазом, а
 * заметит это тот, кто уже поверил числу.
 */

/* ── Счёт ────────────────────────────────────────────────────────── */

/*
 * «Истёк» — своё состояние, а не отменённый счёт: у счёта есть срок, и
 * вышедший срок — событие часов, а не решение человека. Слова — те же,
 * что у образца и у самой заявки на обмен: «ожидает», «истёк».
 */
export const invoiceStatuses = ['issued', 'paid', 'expired', 'cancelled'] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  issued: 'Ожидает',
  paid: 'Оплачен',
  expired: 'Истёк',
  cancelled: 'Отменён',
};

/** Тон — по тому же правилу, что у заявок: золото ждёт человека. */
export const INVOICE_STATUS_TONES: Record<InvoiceStatus, PillTone> = {
  issued: 'wait',
  paid: 'done',
  expired: 'off',
  cancelled: 'off',
};

/** Строка ленты «что происходило»: когда и что. */
export interface MockEvent {
  readonly at: string;
  readonly what: string;
}

export interface MockInvoice {
  readonly id: string;
  /** Короткий номер: его называют покупателю вслух. */
  readonly number: string;
  /** Кто создал: имя того, кто нажал «Создать счёт». */
  readonly author: string;
  /** Валюта покупателя и сумма в ней. */
  readonly code: string;
  readonly amount: Amount;
  /** Чем платит покупатель и сколько — вверх до целой единицы. */
  readonly payCode: string;
  readonly payAmount: Amount;
  /**
   * Курс, записанный в счёт при создании. По нему и только по нему
   * счёт приводится к валюте оплаты потом: исторического курса у
   * сервиса нет, и задним числом он его не выдумывает (docs/adr/0013).
   */
  readonly rate: Amount;
  /**
   * Наценка мерчанта, с которой счёт посчитан, в базисных пунктах.
   * Записана в счёт, как и курс: настройку потом поменяют, а счёт
   * обязан объяснять своё число и через месяц.
   */
  readonly markupBps: number;
  readonly status: InvoiceStatus;
  readonly createdAt: string;
  /** Когда счёт перестаёт приниматься к оплате. Пусто у счетов без срока. */
  readonly expiresAt: string | null;
  readonly paidAt: string | null;
  /** Покупатель подтверждает личность до оплаты — и когда подтвердил. */
  readonly kycRequired: boolean;
  readonly kycPassedAt: string | null;
  /** Кто принимает платёж и как он его у себя называет. Пусто у счетов до провайдера. */
  readonly payment: { readonly provider: string; readonly ref: string } | null;
  /** Пример, заведённый ради показа, а не счёт покупателю. */
  readonly demo: boolean;
  readonly events: readonly MockEvent[];
}

export const invoiceColumns = [
  'number',
  'author',
  'amount',
  'status',
  'created',
] as const;
export type InvoiceColumn = (typeof invoiceColumns)[number];

export const INVOICE_COLUMN_LABELS: Record<InvoiceColumn, string> = {
  number: 'Счёт',
  author: 'Создатель',
  amount: 'Сумма',
  status: 'Состояние',
  created: 'Создан',
};

/**
 * Колонки, которые не выключаются: без номера, суммы и состояния
 * строка не отвечает на вопрос, ради которого открывают список.
 */
export const REQUIRED_INVOICE_COLUMNS: readonly InvoiceColumn[] = ['number', 'amount', 'status'];

export interface Cell {
  /** Главное в ячейке. */
  readonly text: string;
  /** Вторая строка под ним: эквивалент, время. */
  readonly meta?: string | undefined;
  /** Числовая — прижимается вправо. */
  readonly numeric?: boolean | undefined;
}

/**
 * Ячейка колонки.
 *
 * Дата — днём без часа и по местному времени того, кто смотрит:
 * смещение пояса кладёт в куку шапка, и по нему же считает период
 * аналитика. Без него мерчант из Бангкока видел бы в файле вчерашний
 * день у счёта, созданного в три часа ночи, а на экране сегодняшний.
 */
export function invoiceCell(
  one: MockInvoice,
  column: InvoiceColumn,
  offsetMinutes = 0,
): Cell {
  switch (column) {
    case 'number':
      return { text: one.number };
    case 'author':
      return { text: one.author };
    case 'amount':
      return {
        text: formatMoney(one.amount, one.code),
        // Эквивалент — по курсу, записанному в счёт: другого у сервиса
        // нет, а сегодняшним курсом вчерашний счёт пересчитывать нельзя.
        meta: `${formatMoney(one.payAmount, one.payCode)} по курсу ${formatRate(one.rate, one.payCode, one.code)}`,
        numeric: true,
      };
    case 'status':
      // Пример подписан прямо в строке: без подписи он читается как
      // счёт покупателю, которого не было.
      return { text: INVOICE_STATUS_LABELS[one.status], meta: one.demo ? 'пример' : undefined };
    case 'created':
      return { text: localDayOf(one.createdAt, offsetMinutes), numeric: true };
  }
}

/** День «2026-09-12» по местному времени того, кто смотрит. */
function localDayOf(at: string, offsetMinutes: number): string {
  return new Date(new Date(at).getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/* ── Возврат ─────────────────────────────────────────────────────── */

export const refundStatuses = ['pending', 'approved', 'done', 'rejected'] as const;
export type RefundStatus = (typeof refundStatuses)[number];

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  pending: 'Ожидает',
  approved: 'Одобрен',
  done: 'Исполнен',
  rejected: 'Отклонён',
};

export const REFUND_STATUS_TONES: Record<RefundStatus, PillTone> = {
  pending: 'wait',
  approved: 'plain',
  done: 'done',
  rejected: 'off',
};

export interface MockRefund {
  readonly id: string;
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly code: string;
  /** Сколько возвращаем покупателю. */
  readonly amount: Amount;
  /**
   * Что остаётся у мерчанта при частичном возврате: разность суммы
   * счёта и суммы возврата, а не комиссия сервиса. Комиссию мы не
   * считаем — у кого она удерживается, владелец ещё не назвал, и
   * выдуманный процент читался бы как наш тариф.
   */
  readonly retained: Amount | null;
  readonly reason: string;
  readonly status: RefundStatus;
  readonly createdAt: string;
  /** Когда деньги ушли покупателю. Пусто, пока возврат не исполнен. */
  readonly doneAt: string | null;
  /** Кто исполнял возврат. Пусто у заявок, поданных до провайдера. */
  readonly provider: string | null;
  /** Пример, заведённый ради показа. */
  readonly demo: boolean;
}

export const refundColumns = [
  'invoice',
  'amount',
  'retained',
  'reason',
  'status',
  'created',
] as const;
export type RefundColumn = (typeof refundColumns)[number];

export const REFUND_COLUMN_LABELS: Record<RefundColumn, string> = {
  invoice: 'Счёт',
  amount: 'Возврат',
  retained: 'Остаётся у вас',
  reason: 'Причина',
  status: 'Состояние',
  created: 'Заявлен',
};

/**
 * Заявки, по которым деньги ещё считаются обещанными покупателю.
 *
 * Отклонённая не в счёт: по ней ничего не уходит. Правило одно на два
 * места — на плитку «к возврату» и на остаток по счёту, — потому что
 * два ответа на вопрос «сколько ещё должны» расходятся при первой
 * правке, а заметит это тот, кто уже пообещал покупателю.
 */
export function owedRefunds(refunds: readonly MockRefund[]): readonly MockRefund[] {
  return refunds.filter((one) => one.status !== 'rejected');
}

/** Сколько по счёту ещё можно вернуть: сумма счёта минус обещанное. */
export function refundLeft(
  invoice: MockInvoice,
  refunds: readonly MockRefund[],
): Amount {
  const already = owedRefunds(refunds)
    .filter((one) => one.invoiceId === invoice.id)
    .reduce((sum, one) => Money.add(sum, one.amount), Money.ZERO);
  const left = Money.subtract(invoice.amount, already);
  return Money.isNegative(left) ? Money.ZERO : left;
}

export function refundCell(
  one: MockRefund,
  column: RefundColumn,
  offsetMinutes = 0,
): Cell {
  switch (column) {
    case 'invoice':
      return { text: one.invoiceNumber };
    case 'amount':
      return { text: formatMoney(one.amount, one.code), numeric: true };
    case 'retained':
      return {
        text: one.retained === null ? '—' : formatMoney(one.retained, one.code),
        meta: one.retained === null ? 'возврат целиком' : undefined,
        numeric: true,
      };
    case 'reason':
      return { text: one.reason };
    case 'status':
      return { text: REFUND_STATUS_LABELS[one.status], meta: one.demo ? 'пример' : undefined };
    case 'created':
      return { text: localDayOf(one.createdAt, offsetMinutes), numeric: true };
  }
}

/* ── Числа над списками ──────────────────────────────────────────── */

/** Счета, за которые деньги получены: оборот — только они. */
export function paidOnly(invoices: readonly MockInvoice[]): readonly MockInvoice[] {
  return invoices.filter((one) => one.status === 'paid');
}

/**
 * Оборот счетов в выбранной валюте.
 *
 * Считается по оплаченным: ожидающий и тем более отменённый счёт —
 * это бумага, а не деньги, и «оборот 50 000» рядом с «оплачено 0»
 * читался бы как ошибка в счётчике, а не в подписи.
 *
 * Валюта оплаты (рубль) складывается по всем таким счетам: у каждого
 * записан свой курс, и сумма в ней точная. Валюта покупателя — только
 * по счетам в ней: сводить баты с юанями нечем, курса между ними у
 * сервиса нет и задним числом он его не выдумывает.
 */
export function invoiceTotal(
  invoices: readonly MockInvoice[],
  code: string,
): { readonly amount: Amount; readonly count: number } {
  let amount = Money.ZERO;
  let count = 0;
  for (const one of paidOnly(invoices)) {
    if (one.payCode === code) {
      amount = Money.add(amount, one.payAmount);
      count += 1;
    } else if (one.code === code) {
      amount = Money.add(amount, one.amount);
      count += 1;
    }
  }
  return { amount, count };
}

/** Все валюты, встретившиеся в счетах: из них и выбирают, в чём считать. */
export function invoiceCurrencies(invoices: readonly MockInvoice[]): readonly string[] {
  const codes = new Set<string>();
  for (const one of invoices) {
    codes.add(one.payCode);
    codes.add(one.code);
  }
  return [...codes].sort((a, b) => a.localeCompare(b));
}

/** Суммы оплаченных счетов по валютам покупателя — без сложения между собой. */
export function invoiceMoneyLines(invoices: readonly MockInvoice[]): readonly MoneyLine[] {
  const byCode = new Map<string, { amount: Amount; count: number }>();
  for (const one of paidOnly(invoices)) {
    const line = byCode.get(one.code) ?? { amount: Money.ZERO, count: 0 };
    byCode.set(one.code, { amount: Money.add(line.amount, one.amount), count: line.count + 1 });
  }
  return [...byCode.entries()]
    .map(([code, line]) => ({ code, amount: line.amount, count: line.count }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function countByStatus<T extends { status: string }>(
  rows: readonly T[],
  status: string | undefined,
): number {
  return status === undefined ? rows.length : rows.filter((one) => one.status === status).length;
}

/**
 * Поиск по списку счетов — по номеру: другого слова у счёта нет.
 *
 * До 22 сентября 2026 у счёта были назначение и покупатель, и поиск шёл
 * и по ним; владелец попросил оба поля убрать — у стойки их никто не
 * набирал, а заявку по API они и не описывали.
 *
 * Сужает сам список, а не прячет строки разметкой: список макета живёт
 * в памяти процесса целиком, и «нашлось 3» обязано означать, что
 * подходящих три, а не что остальные скрыты.
 */
export function searchInvoices(
  invoices: readonly MockInvoice[],
  query: string | undefined,
): readonly MockInvoice[] {
  const needle = query?.trim().toLowerCase();
  if (!needle) return invoices;
  return invoices.filter((one) =>
    one.number.toLowerCase().includes(needle),
  );
}
