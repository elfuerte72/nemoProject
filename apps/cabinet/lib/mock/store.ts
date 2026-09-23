/**
 * Память макета: счета, возвраты и настройки терминала живут в
 * процессе, а не в базе.
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
 * Заранее ничего не заводится: на экране нет чисел, которых нет в
 * данных. Примеры (`pos/demo.ts`) — исключение по прямой просьбе через
 * окружение, и каждый подписан словом «пример».
 *
 * Срок счёта считается при чтении: список отдаётся с уже истёкшими
 * счетами, и отдельный таймер по счетам не ходит (`pos/lifecycle.ts`).
 */

import type { MockInvoice, MockRefund } from '../invoice-rows';
import { demoAsked, demoSet } from '../pos/demo';
import { expireAllDue, isDeletable, settleAllRefunds } from '../pos/lifecycle';
import { DEFAULT_POS_SETTINGS, type PosSettings } from '../pos/settings';

interface Shelf {
  readonly invoices: Map<string, MockInvoice[]>;
  readonly refunds: Map<string, MockRefund[]>;
  readonly settings: Map<string, PosSettings>;
  /** Кому примеры уже предлагали: второй раз не заводятся, даже если счета удалили. */
  readonly offered: Set<string>;
}

const KEY = Symbol.for('nemo.cabinet.mock');

type Holder = typeof globalThis & { [KEY]?: Shelf };

function shelf(): Shelf {
  const holder = globalThis as Holder;
  holder[KEY] ??= { invoices: new Map(), refunds: new Map(), settings: new Map(), offered: new Set() };
  return holder[KEY];
}

/**
 * Примеры — один раз на мерчанта и только пустому: у того, кто уже
 * создал счёт, примеров быть не должно, иначе его продажи смешались
 * бы с выдуманными.
 */
function offerDemo(merchantId: string, now: Date): void {
  const mine = shelf();
  if (mine.offered.has(merchantId)) return;
  mine.offered.add(merchantId);
  if (!demoAsked()) return;
  if ((mine.invoices.get(merchantId) ?? []).length > 0) return;
  const set = demoSet(now);
  mine.invoices.set(merchantId, [...set.invoices]);
  mine.refunds.set(merchantId, [...set.refunds]);
}

/**
 * Счета мерчанта, новыми сверху, с истёкшими по часам `now` и
 * возвращёнными по исполненным возвратам: оба перехода считаются при
 * чтении, и отдельного таймера или второго пути записи у них нет.
 */
export function listInvoices(merchantId: string, now: Date = new Date()): readonly MockInvoice[] {
  offerDemo(merchantId, now);
  const mine = shelf().invoices.get(merchantId) ?? [];
  const refunds = shelf().refunds.get(merchantId) ?? [];
  const settled = settleAllRefunds(expireAllDue(mine, now), refunds);
  if (settled.some((one, index) => one !== mine[index])) {
    shelf().invoices.set(merchantId, [...settled]);
  }
  return settled;
}

export function findInvoice(
  merchantId: string,
  id: string,
  now: Date = new Date(),
): MockInvoice | undefined {
  return listInvoices(merchantId, now).find((one) => one.id === id);
}

export function addInvoice(merchantId: string, invoice: MockInvoice): void {
  offerDemo(merchantId, new Date(invoice.createdAt));
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

/**
 * Удалить счета мерчанта и вернуть, какие удалены. Отбирает их
 * `bulkTargets`, но правило «денег по нему не было» проверяется ещё раз
 * здесь, в момент удаления: между отбором и удалением идёт отмена у
 * провайдера, и банк успевает сообщить об оплате — оплаченный за это
 * время счёт остаётся. Чужой счёт с тем же идентификатором не задет:
 * выборка — по полке своего мерчанта.
 */
export function removeInvoices(merchantId: string, ids: readonly string[]): readonly string[] {
  const asked = new Set(ids);
  const mine = shelf().invoices.get(merchantId) ?? [];
  const gone = mine.filter((one) => asked.has(one.id) && isDeletable(one)).map((one) => one.id);
  shelf().invoices.set(
    merchantId,
    mine.filter((one) => !gone.includes(one.id)),
  );
  return gone;
}

export function listRefunds(merchantId: string): readonly MockRefund[] {
  offerDemo(merchantId, new Date());
  return shelf().refunds.get(merchantId) ?? [];
}

export function addRefund(merchantId: string, refund: MockRefund): void {
  const mine = shelf().refunds.get(merchantId) ?? [];
  shelf().refunds.set(merchantId, [refund, ...mine]);
}

/**
 * Замена возврата на месте — тем же приёмом, что у счёта. Сюда придёт
 * сообщение банка «возврат исполнен»; счёт от этого станет возвращённым
 * при ближайшем чтении (`settleAllRefunds`).
 */
export function replaceRefund(merchantId: string, refund: MockRefund): void {
  const mine = shelf().refunds.get(merchantId) ?? [];
  shelf().refunds.set(
    merchantId,
    mine.map((one) => (one.id === refund.id ? refund : one)),
  );
}

/** Настройки терминала: наценка и скрытые валюты. Без записи — умолчания. */
export function getPosSettings(merchantId: string): PosSettings {
  return shelf().settings.get(merchantId) ?? DEFAULT_POS_SETTINGS;
}

export function savePosSettings(merchantId: string, settings: PosSettings): void {
  shelf().settings.set(merchantId, settings);
}

/** Забыть всё про мерчанта. Нужно тестам: процесс у них один на файл. */
export function forgetMock(merchantId: string): void {
  shelf().invoices.delete(merchantId);
  shelf().refunds.delete(merchantId);
  shelf().settings.delete(merchantId);
  shelf().offered.delete(merchantId);
}

/**
 * Сколько счетов мерчант создал за смену. Смена — сутки по часам
 * того, кто смотрит: терминал работает день, а не с полуночи по UTC.
 */
export function countSince(merchantId: string, since: Date): number {
  return listInvoices(merchantId).filter((one) => new Date(one.createdAt) >= since).length;
}
