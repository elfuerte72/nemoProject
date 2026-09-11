/**
 * Память макета: счета и возвраты живут в процессе, а не в базе.
 *
 * Так решено 10 сентября 2026 (`backlog.md`, «Счета, пост-терминал и
 * возвраты — макет без денег»): за счётом у образца стоит приём денег
 * покупателя, а Tobee их не принимает и баланса мерчанта не ведёт.
 * Пока не названо, чем платит покупатель и у кого удерживается
 * комиссия при возврате, схема получится выдуманной, а переписывать её
 * придётся вместе с первым живым платежом. Экран нарисовать можно,
 * таблицу — нельзя.
 *
 * Отсюда и место хранения: `globalThis`, как у пределов API и виденных
 * подписей. Плата известна и названа на экране — записи живут до
 * перезапуска процесса, а при нескольких процессах у каждого свои.
 * Врать об этом нельзя: мерчант, потерявший счёт после выкатки, решит,
 * что сервис теряет деньги.
 *
 * Чужого здесь не видно: ключ карты — идентификатор мерчанта, и каждая
 * выборка идёт по нему. Правило то же, что у операций ядра, и покрыто
 * тестом — макет это или нет, чужие числа в кабинете недопустимы.
 *
 * Ничего не заводится заранее: на экране нет чисел, которых нет в
 * данных. Нарисованный пример счёта читался бы как настоящий счёт.
 */

import type { MockInvoice, MockRefund } from '../invoice-rows';

interface Shelf {
  readonly invoices: Map<string, MockInvoice[]>;
  readonly refunds: Map<string, MockRefund[]>;
}

const KEY = Symbol.for('nemo.cabinet.mock');

type Holder = typeof globalThis & { [KEY]?: Shelf };

function shelf(): Shelf {
  const holder = globalThis as Holder;
  holder[KEY] ??= { invoices: new Map(), refunds: new Map() };
  return holder[KEY];
}

/** Счета мерчанта, новыми сверху. */
export function listInvoices(merchantId: string): readonly MockInvoice[] {
  return shelf().invoices.get(merchantId) ?? [];
}

export function findInvoice(merchantId: string, id: string): MockInvoice | undefined {
  return listInvoices(merchantId).find((one) => one.id === id);
}

export function addInvoice(merchantId: string, invoice: MockInvoice): void {
  const mine = shelf().invoices.get(merchantId) ?? [];
  shelf().invoices.set(merchantId, [invoice, ...mine]);
}

/**
 * Замена счёта на месте: порядок списка от правки не меняется —
 * отмеченный оплаченным счёт не должен уезжать наверх.
 */
export function replaceInvoice(merchantId: string, invoice: MockInvoice): void {
  const mine = shelf().invoices.get(merchantId) ?? [];
  shelf().invoices.set(
    merchantId,
    mine.map((one) => (one.id === invoice.id ? invoice : one)),
  );
}

export function listRefunds(merchantId: string): readonly MockRefund[] {
  return shelf().refunds.get(merchantId) ?? [];
}

export function addRefund(merchantId: string, refund: MockRefund): void {
  const mine = shelf().refunds.get(merchantId) ?? [];
  shelf().refunds.set(merchantId, [refund, ...mine]);
}

/** Забыть всё про мерчанта. Нужно тестам: процесс у них один на файл. */
export function forgetMock(merchantId: string): void {
  shelf().invoices.delete(merchantId);
  shelf().refunds.delete(merchantId);
}

/**
 * Сколько счетов мерчант выставил за смену. Смена — сутки по часам
 * того, кто смотрит: касса работает день, а не с полуночи по UTC.
 */
export function countSince(merchantId: string, since: Date): number {
  return listInvoices(merchantId).filter((one) => new Date(one.createdAt) >= since).length;
}
