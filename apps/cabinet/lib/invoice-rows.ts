import { Money, type Amount } from '@nemo/types';
import { formatMoney, formatRate } from '@nemo/ui/format';
import type { MoneyLine } from '@nemo/ui/money-list';
import type { PillTone } from './labels';
import { INVOICE_OPEN_LABEL } from './pos-texts';

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
 *
 * «Возвращён» — счёт, деньги по которому вернули покупателю целиком
 * (`settleRefunds` в `pos/lifecycle.ts`). Частичный возврат оставляет
 * счёт оплаченным и виден отметкой в строке: часть денег у мерчанта
 * осталась, и в табе «Возвращены» такой счёт читался бы как потеря всей
 * суммы. Так же устроено у образца.
 */
export const invoiceStatuses = ['issued', 'paid', 'expired', 'cancelled', 'refunded'] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  issued: 'Ожидает',
  paid: 'Оплачен',
  expired: 'Истёк',
  cancelled: 'Отменён',
  refunded: 'Возвращён',
};

/** Тон — по тому же правилу, что у заявок: золото ждёт человека. */
export const INVOICE_STATUS_TONES: Record<InvoiceStatus, PillTone> = {
  issued: 'wait',
  paid: 'done',
  expired: 'off',
  cancelled: 'off',
  // Нейтральный, а не красный: красное у нас — отказ, а возврат — это
  // исход, о котором мерчант договорился с покупателем сам.
  refunded: 'plain',
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
  /**
   * Он же идентификатором: по нему «только мои» отличает свои счета от
   * счетов коллег. Имена у людей мерчанта повторяются, а переименованный
   * человек не должен терять своих счетов. Пусто у примеров.
   */
  readonly authorId: string | null;
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

/*
 * Сделка — двумя колонками, а не одной «Суммой» с эквивалентом мелко
 * под ней: у стойки спрашивают и «сколько заплатили», и «сколько
 * выдали», и второе число, набранное мелким шрифтом, приходилось
 * выискивать. Подписи — те же, что у строк расчёта в POS-терминале.
 */
export const invoiceColumns = [
  'number',
  'author',
  'pays',
  'gets',
  'status',
  'created',
  'open',
] as const;
export type InvoiceColumn = (typeof invoiceColumns)[number];

export const INVOICE_COLUMN_LABELS: Record<InvoiceColumn, string> = {
  number: 'Счёт',
  author: 'Создатель',
  pays: 'Покупатель платит',
  gets: 'Покупатель получает',
  status: 'Состояние',
  created: 'Даты',
  open: 'Действия',
};

/** В файл уходят данные, а не кнопки. */
export const INVOICE_EXPORT_COLUMNS: readonly InvoiceColumn[] = invoiceColumns.filter(
  (one) => one !== 'open',
);

/**
 * Колонки, которые не выключаются: без номера, обеих сумм и состояния
 * строка не отвечает на вопрос, ради которого открывают список.
 */
export const REQUIRED_INVOICE_COLUMNS: readonly InvoiceColumn[] = ['number', 'pays', 'gets', 'status'];

export interface Cell {
  /** Главное в ячейке. */
  readonly text: string;
  /** Вторая строка под ним: курс, время. */
  readonly meta?: string | undefined;
  /** Числовая — прижимается вправо. */
  readonly numeric?: boolean | undefined;
  /** Валюта суммы в ячейке: экран ставит перед числом её значок. */
  readonly flag?: string | undefined;
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
  /** Отметки строки (`invoiceMarks`): идут второй строкой под состоянием. */
  marks?: readonly string[],
): Cell {
  switch (column) {
    case 'number':
      return { text: one.number };
    case 'author':
      return { text: one.author };
    case 'pays':
      return { text: formatMoney(one.payAmount, one.payCode), numeric: true, flag: one.payCode };
    case 'gets':
      return {
        text: formatMoney(one.amount, one.code),
        // Курс — записанный в счёт: другого у сервиса нет, а сегодняшним
        // курсом вчерашний счёт пересчитывать нельзя.
        meta: `по курсу ${formatRate(one.rate, one.payCode, one.code)}`,
        numeric: true,
        flag: one.code,
      };
    case 'status': {
      // Пример подписан прямо в строке: без подписи он читается как
      // счёт покупателю, которого не было.
      const shown = marks ?? (one.demo ? ['пример'] : []);
      return {
        text: INVOICE_STATUS_LABELS[one.status],
        meta: shown.length > 0 ? shown.join(' · ') : undefined,
      };
    }
    case 'created':
      // Под созданием — когда заплатили: «выставлен утром, оплачен
      // вечером» отвечает покупателю, который говорит «я же заплатил».
      return {
        text: localDayOf(one.createdAt, offsetMinutes),
        meta: one.paidAt ? `оплачен ${localDayOf(one.paidAt, offsetMinutes)}` : undefined,
        numeric: true,
      };
    case 'open':
      return { text: INVOICE_OPEN_LABEL };
  }
}

/**
 * Отметки строки под состоянием: пример, частичный возврат, верификация.
 *
 * Частичный — это оплаченный счёт, по которому часть уже обещана
 * покупателю обратно: состояние у него прежнее, и без отметки строка
 * «Оплачен 5 600» обещала бы мерчанту деньги, которых у него уже нет.
 * Обещано всё, но банк ещё не отдал, — счёт тоже оплачен
 * (`settleRefunds` ждёт исполнения), и отметка говорит, что возврат в
 * пути, а не что он частичный.
 */
export function invoiceMarks(
  invoice: MockInvoice,
  refunds: readonly MockRefund[],
): readonly string[] {
  const marks: string[] = [];
  if (invoice.demo) marks.push('пример');
  if (invoice.status === 'paid' && !Money.isZero(refundedSoFar(invoice, refunds))) {
    marks.push(
      Money.isZero(refundLeft(invoice, refunds)) ? 'возврат ждёт исполнения' : 'частичный возврат',
    );
  }
  if (invoice.kycRequired) marks.push('верификация');
  return marks;
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

/*
 * Колонки — тем же набором, что у списка счетов: сумма со значком
 * валюты, даты одной колонкой, «Подробнее» в конце строки. Два списка
 * одного терминала, устроенные по-разному, заставляли бы читать каждый
 * заново.
 */
export const refundColumns = [
  'invoice',
  'amount',
  'retained',
  'reason',
  'status',
  'created',
  'open',
] as const;
export type RefundColumn = (typeof refundColumns)[number];

export const REFUND_COLUMN_LABELS: Record<RefundColumn, string> = {
  invoice: 'Счёт',
  amount: 'Возврат',
  retained: 'Остаётся у вас',
  reason: 'Причина',
  status: 'Состояние',
  created: 'Даты',
  open: 'Действия',
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

/** Сколько по счёту уже обещано вернуть — в валюте покупателя. */
export function refundedSoFar(
  invoice: MockInvoice,
  refunds: readonly MockRefund[],
): Amount {
  return owedRefunds(refunds)
    .filter((one) => one.invoiceId === invoice.id)
    .reduce((sum, one) => Money.add(sum, one.amount), Money.ZERO);
}

/** Сколько по счёту ещё можно вернуть: сумма счёта минус обещанное. */
export function refundLeft(
  invoice: MockInvoice,
  refunds: readonly MockRefund[],
): Amount {
  const left = Money.subtract(invoice.amount, refundedSoFar(invoice, refunds));
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
      return { text: formatMoney(one.amount, one.code), numeric: true, flag: one.code };
    case 'retained':
      return {
        text: one.retained === null ? '—' : formatMoney(one.retained, one.code),
        meta: one.retained === null ? 'возврат целиком' : undefined,
        numeric: true,
      };
    case 'reason':
      return { text: one.reason };
    case 'status': {
      // Ждёт без провайдера — значит, счёт оплатили мимо сервиса и
      // исполнять заявку некому: без слов строка «Ожидает» обещала бы,
      // что деньги уйдут сами.
      const marks = [
        ...(one.demo ? ['пример'] : []),
        ...(one.status === 'pending' && one.provider === null ? ['возвращать некому'] : []),
      ];
      return {
        text: REFUND_STATUS_LABELS[one.status],
        meta: marks.length > 0 ? marks.join(' · ') : undefined,
      };
    }
    case 'created':
      // Под заявкой — когда деньги ушли: «заявил вчера, исполнили
      // сегодня» отвечает покупателю, который спрашивает, где его деньги.
      return {
        text: localDayOf(one.createdAt, offsetMinutes),
        meta: one.doneAt ? `исполнен ${localDayOf(one.doneAt, offsetMinutes)}` : undefined,
        numeric: true,
      };
    case 'open':
      return { text: INVOICE_OPEN_LABEL };
  }
}

export interface RefundSummary {
  readonly total: number;
  readonly pending: number;
  readonly approved: number;
  /** Ждущие и одобренные: деньги по ним ещё не ушли. */
  readonly inWork: number;
  readonly done: number;
  readonly rejected: number;
}

/**
 * Счётчики плиток над списком возвратов. «В работе» — всё, по чему
 * деньги покупателю ещё не ушли: заявка, которую банк принял, но не
 * исполнил, для мерчанта так же не закрыта, как ждущая.
 */
export function refundSummary(refunds: readonly MockRefund[]): RefundSummary {
  const pending = countByStatus(refunds, 'pending');
  const approved = countByStatus(refunds, 'approved');
  return {
    total: refunds.length,
    pending,
    approved,
    inWork: pending + approved,
    done: countByStatus(refunds, 'done'),
    rejected: countByStatus(refunds, 'rejected'),
  };
}

/**
 * Обещанное покупателям по каждой валюте из списка — для плитки «К
 * возврату». Правило суммы то же, что у остатка по счёту
 * (`owedRefunds`): отклонённые не в счёт. Пустые валюты названы, как в
 * разборе оплат (`currencyBreakdown`), и валюты не складываются.
 */
export function refundBreakdown(
  refunds: readonly MockRefund[],
  codes: readonly string[],
): readonly CurrencyShare[] {
  return spreadOver(moneyLines(owedRefunds(refunds)), codes);
}

/* ── Числа над списками ──────────────────────────────────────────── */

/**
 * Счета, за которые деньги получены: оборот — только они. Возвращённый
 * тоже был оплачен — деньги пришли и ушли обратно, и уход считается
 * возвратом, а не тем, что оплаты не было.
 */
export function paidOnly(invoices: readonly MockInvoice[]): readonly MockInvoice[] {
  return invoices.filter((one) => one.status === 'paid' || one.status === 'refunded');
}

/**
 * Сумма счёта в выбранной валюте — той стороной, что в ней и записана.
 * Счёт, у которого такой стороны нет, в этой валюте суммы не имеет:
 * курса между батом и юанем у сервиса нет.
 */
function amountIn(invoice: MockInvoice, code: string): Amount | null {
  if (invoice.payCode === code) return invoice.payAmount;
  if (invoice.code === code) return invoice.amount;
  return null;
}

/**
 * Возврат в выбранной валюте. Заявлен он в валюте покупателя, а в
 * валюту оплаты переводится долей самого счёта: вернули четверть батов
 * — значит, и четверть рублей. Суммы записаны в счёт, другого курса у
 * сервиса нет.
 *
 * Переводится всё возвращённое по счёту разом, а не каждый возврат
 * порознь: три трети, округлённые по отдельности, давали 2499,99 из
 * 2500, и возвращённый целиком счёт оставлял копейку в обороте. Доля
 * ровняется к ближайшему до знака валюты оплаты — того же, до которого
 * ровняется сама сумма к оплате (`payRounding`): у рубля до целого, у
 * монеты до её знака. Возврат целиком — сама сумма оплаты, без деления.
 */
function refundedIn(
  invoice: MockInvoice,
  back: Amount,
  code: string,
  decimals: number,
): Amount | null {
  if (invoice.code === code) return back;
  if (invoice.payCode !== code) return null;
  if (Money.compare(back, invoice.amount) >= 0) return invoice.payAmount;
  return Money.roundTo(
    Money.divide(Money.multiply(back, invoice.payAmount), invoice.amount),
    decimals,
  );
}

export interface InvoiceSummary {
  readonly count: number;
  /** Сумма всех счетов в выбранной валюте — выставлено, а не получено. */
  readonly sum: Amount;
  readonly pending: number;
  readonly pendingSum: Amount;
  readonly paid: number;
  readonly paidSum: Amount;
  /** Обещанное покупателям обратно — по оплаченным счетам. */
  readonly refunded: Amount;
  /** Оплачено за вычетом возвратов: то, что у мерчанта осталось. */
  readonly net: Amount;
  /** Доля оплаченных среди выставленных, в процентах. Пусто без счетов. */
  readonly conversion: number | null;
}

/**
 * Числа плиток над списком — по образцу: всего, ждут, оплачено с
 * возвратами, чистый оборот с конверсией.
 *
 * Счётчики — по всем счетам, суммы — в одной выбранной валюте: валюты не
 * складываются никогда (docs/adr/0013), и счёт, у которого стороны в
 * этой валюте нет, в сумму не попадает, а в счётчик попадает.
 */
export function invoiceSummary(
  invoices: readonly MockInvoice[],
  refunds: readonly MockRefund[],
  code: string,
  /** Знак выбранной валюты для доли возврата — `payRounding` справочника. */
  decimals: number,
): InvoiceSummary {
  let sum = Money.ZERO;
  let pendingSum = Money.ZERO;
  let paidSum = Money.ZERO;
  let refunded = Money.ZERO;
  let pending = 0;
  const paid = paidOnly(invoices);

  for (const one of invoices) {
    const value = amountIn(one, code);
    if (value !== null) sum = Money.add(sum, value);
    if (one.status === 'issued') {
      pending += 1;
      if (value !== null) pendingSum = Money.add(pendingSum, value);
    }
  }
  for (const one of paid) {
    const value = amountIn(one, code);
    if (value !== null) paidSum = Money.add(paidSum, value);
    const back = refundedSoFar(one, refunds);
    if (Money.isZero(back)) continue;
    const part = refundedIn(one, back, code, decimals);
    if (part !== null) refunded = Money.add(refunded, part);
  }

  return {
    count: invoices.length,
    sum,
    pending,
    pendingSum,
    paid: paid.length,
    paidSum,
    refunded,
    net: Money.subtract(paidSum, refunded),
    conversion: invoices.length === 0 ? null : Math.round((paid.length / invoices.length) * 100),
  };
}

/**
 * Сколько событий пришлось на каждые сутки отрезка `[from, to)` — ход
 * для плитки. Границы — местные полуночи, выраженные моментом UTC
 * (`localMidnight`), поэтому сутки считаются делением, без пояса.
 */
export function dailySeries(ats: readonly string[], from: Date, to: Date): number[] {
  const day = 24 * 60 * 60_000;
  const days = Math.max(0, Math.ceil((to.getTime() - from.getTime()) / day));
  const series = Array.from({ length: days }, () => 0);
  for (const at of ats) {
    const index = Math.floor((new Date(at).getTime() - from.getTime()) / day);
    if (index >= 0 && index < days) series[index] = (series[index] ?? 0) + 1;
  }
  return series;
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

/**
 * Суммы по валютам — без сложения между собой (docs/adr/0013), с числом
 * записей в каждой. Одно правило на оплаты и на возвраты.
 */
function moneyLines(
  items: readonly { readonly code: string; readonly amount: Amount }[],
): readonly MoneyLine[] {
  const byCode = new Map<string, { amount: Amount; count: number }>();
  for (const one of items) {
    const line = byCode.get(one.code) ?? { amount: Money.ZERO, count: 0 };
    byCode.set(one.code, { amount: Money.add(line.amount, one.amount), count: line.count + 1 });
  }
  return [...byCode.entries()]
    .map(([code, line]) => ({ code, amount: line.amount, count: line.count }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Строки по каждой валюте из списка, пустые тоже: «юаней не продавали»
 * — такой же ответ, как «продали на 850», и пропавшая из списка валюта
 * читалась бы как ошибка списка.
 */
function spreadOver(lines: readonly MoneyLine[], codes: readonly string[]): readonly CurrencyShare[] {
  const byCode = new Map(lines.map((line) => [line.code, line]));
  return codes.map((code) => {
    const line = byCode.get(code);
    return line
      ? { code, amount: line.amount, count: line.count ?? 0 }
      : { code, amount: null, count: 0 };
  });
}

/** Суммы оплаченных счетов по валютам покупателя — без сложения между собой. */
export function invoiceMoneyLines(invoices: readonly MockInvoice[]): readonly MoneyLine[] {
  return moneyLines(paidOnly(invoices));
}

export interface CurrencyShare {
  readonly code: string;
  /** Оплаченное в этой валюте. Пусто — оплат в ней не было. */
  readonly amount: Amount | null;
  readonly count: number;
}

/**
 * Оплаченное по каждой валюте из списка — для раскрытой плитки «По
 * валютам». Валюты те же, что в выборе оборота, и пустые названы тоже.
 */
export function currencyBreakdown(
  invoices: readonly MockInvoice[],
  codes: readonly string[],
): readonly CurrencyShare[] {
  return spreadOver(invoiceMoneyLines(invoices), codes);
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

/**
 * Отбор списка: поиск, период по дате создания и «только мои».
 *
 * Период — полуинтервал `[from, to)`, как у ядра и у списка заявок.
 * «Только мои» — по идентификатору того, кто нажал «Создать счёт», а не
 * по имени: имена у людей мерчанта повторяются.
 */
export function narrowInvoices(
  invoices: readonly MockInvoice[],
  by: {
    readonly query?: string | undefined;
    readonly from?: Date | undefined;
    readonly to?: Date | undefined;
    readonly authorId?: string | undefined;
  },
): readonly MockInvoice[] {
  return searchInvoices(invoices, by.query).filter((one) => {
    const at = new Date(one.createdAt).getTime();
    if (by.from && at < by.from.getTime()) return false;
    if (by.to && at >= by.to.getTime()) return false;
    if (by.authorId !== undefined && one.authorId !== by.authorId) return false;
    return true;
  });
}

export interface Page<T> {
  readonly rows: readonly T[];
  readonly page: number;
  readonly pages: number;
  /** Номера первой и последней строки страницы — «1–25 из 55». Ноль у пустой. */
  readonly first: number;
  readonly last: number;
  readonly total: number;
}

/**
 * Страница списка. Номер за краем — ближайшая настоящая страница, а не
 * пустая: адрес со страницей переживает отбор, который список укоротил,
 * и «ничего нет» на третьей странице при двенадцати счетах читалось бы
 * как потеря.
 */
export function pageOf<T>(rows: readonly T[], page: number, perPage: number): Page<T> {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const asked = Number.isFinite(page) ? Math.trunc(page) : 1;
  const current = Math.min(Math.max(asked, 1), pages);
  const start = (current - 1) * perPage;
  const slice = rows.slice(start, start + perPage);
  return {
    rows: slice,
    page: current,
    pages,
    first: total === 0 ? 0 : start + 1,
    last: start + slice.length,
    total,
  };
}
