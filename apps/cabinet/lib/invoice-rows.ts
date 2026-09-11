import { Money, type Amount } from '@nemo/types';
import { formatMoney, formatRate } from '@nemo/ui/format';
import type { MoneyLine } from '@nemo/ui/money-list';
import type { PillTone } from './labels';

/**
 * Счёт и возврат кассы — макет без денег.
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

export const invoiceStatuses = ['issued', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  issued: 'Выставлен',
  paid: 'Оплачен',
  cancelled: 'Отменён',
};

/** Тон — по тому же правилу, что у заявок: золото ждёт человека. */
export const INVOICE_STATUS_TONES: Record<InvoiceStatus, PillTone> = {
  issued: 'wait',
  paid: 'done',
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
  readonly purpose: string;
  readonly buyer: string;
  /** Кто выставил: имя мерчанта или «Касса». */
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
  readonly status: InvoiceStatus;
  readonly createdAt: string;
  readonly paidAt: string | null;
  readonly events: readonly MockEvent[];
}

export const invoiceColumns = [
  'number',
  'buyer',
  'author',
  'amount',
  'status',
  'created',
] as const;
export type InvoiceColumn = (typeof invoiceColumns)[number];

export const INVOICE_COLUMN_LABELS: Record<InvoiceColumn, string> = {
  number: 'Счёт',
  buyer: 'Покупатель',
  author: 'Создатель',
  amount: 'Сумма',
  status: 'Состояние',
  created: 'Выставлен',
};

/**
 * Колонки, которые не выключаются: без номера, суммы и состояния
 * строка не отвечает на вопрос, ради которого открывают список.
 */
export const REQUIRED_INVOICE_COLUMNS: readonly InvoiceColumn[] = ['number', 'amount', 'status'];

export interface Cell {
  /** Главное в ячейке. */
  readonly text: string;
  /** Вторая строка под ним: назначение, эквивалент, время. */
  readonly meta?: string | undefined;
  /** Числовая — прижимается вправо. */
  readonly numeric?: boolean | undefined;
}

/**
 * Ячейка колонки. Дата здесь днём без часа: час печатает браузер
 * (`Moment`), а сервер живёт в UTC — в списке стоит день, в карточке
 * полное время.
 */
export function invoiceCell(one: MockInvoice, column: InvoiceColumn): Cell {
  switch (column) {
    case 'number':
      return { text: one.number, meta: one.purpose || undefined };
    case 'buyer':
      return { text: one.buyer || '—' };
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
      return { text: INVOICE_STATUS_LABELS[one.status] };
    case 'created':
      return { text: one.createdAt.slice(0, 10), numeric: true };
  }
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

export function refundCell(one: MockRefund, column: RefundColumn): Cell {
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
      return { text: REFUND_STATUS_LABELS[one.status] };
    case 'created':
      return { text: one.createdAt.slice(0, 10), numeric: true };
  }
}

/* ── Числа над списками ──────────────────────────────────────────── */

/**
 * Оборот счетов в выбранной валюте.
 *
 * Валюта оплаты (рубль) считается по всем счетам: у каждого записан
 * свой курс, и сумма в ней — точная. Валюта покупателя — только по
 * счетам в ней: сводить баты с юанями нечем, курса между ними у
 * сервиса нет и задним числом он его не выдумывает.
 */
export function invoiceTotal(
  invoices: readonly MockInvoice[],
  code: string,
): { readonly amount: Amount; readonly count: number } {
  let amount = Money.ZERO;
  let count = 0;
  for (const one of invoices) {
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

/** Суммы счетов по валютам покупателя — строкой, без сложения между собой. */
export function invoiceMoneyLines(invoices: readonly MockInvoice[]): readonly MoneyLine[] {
  const byCode = new Map<string, { amount: Amount; count: number }>();
  for (const one of invoices) {
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
 * Поиск по списку счетов: номер, назначение, покупатель.
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
    [one.number, one.purpose, one.buyer].some((field) => field.toLowerCase().includes(needle)),
  );
}
