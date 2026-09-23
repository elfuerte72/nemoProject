import { Money } from '@nemo/types';
import { owedRefunds, refundLeft, type MockInvoice, type MockRefund } from '../invoice-rows';

/**
 * Жизнь счёта: чем он становится и от чего.
 *
 * Переходы собраны здесь, а не в маршрутах: маршрутов несколько (кнопка
 * мерчанта, сообщение провайдера, часы), а правило «из какого состояния
 * куда можно» одно. Каждый переход возвращает новый счёт с записью в
 * ленте: лента и есть история, и переход без записи в ней стёр бы
 * причину, по которой счёт стал таким.
 *
 * Функции чистые: время приходит аргументом, и тест не ждёт пяти минут.
 */

/** Ещё ждёт денег: не оплачен, не отменён и срок не вышел. */
export function isPayable(invoice: MockInvoice, now: Date): boolean {
  return invoice.status === 'issued' && !isDue(invoice, now);
}

/** Срок счёта вышел. Без срока счёт живёт, пока его не закроют руками. */
export function isDue(invoice: MockInvoice, now: Date): boolean {
  return invoice.expiresAt !== null && new Date(invoice.expiresAt).getTime() <= now.getTime();
}

/**
 * Истечение — по часам, при чтении. Отдельного таймера, который ходил
 * бы по счетам, нет: часы у всех одни, и счёт, прочитанный после срока,
 * истёк ровно в срок, а не когда таймер успел.
 */
export function expireDue(invoice: MockInvoice, now: Date): MockInvoice {
  if (invoice.status !== 'issued' || !isDue(invoice, now)) return invoice;
  return {
    ...invoice,
    status: 'expired',
    events: [...invoice.events, { at: invoice.expiresAt!, what: 'Срок оплаты вышел' }],
  };
}

export function expireAllDue(invoices: readonly MockInvoice[], now: Date): readonly MockInvoice[] {
  return invoices.map((one) => expireDue(one, now));
}

/**
 * Провайдер сообщил, что покупатель заплатил. Если счёт требовал
 * верификации, она прошла у провайдера до денег, и лента говорит об
 * этом отдельной строкой: по ней потом отвечают, кто платил.
 */
export function paidByProvider(
  invoice: MockInvoice,
  notice: { readonly at: Date; readonly providerTitle: string },
): MockInvoice {
  const at = notice.at.toISOString();
  const events = [...invoice.events];
  if (invoice.kycRequired) {
    events.push({ at, what: `Личность покупателя подтверждена: ${notice.providerTitle}` });
  }
  events.push({ at, what: `Оплачен: платёж принял провайдер «${notice.providerTitle}»` });
  return {
    ...invoice,
    status: 'paid',
    paidAt: at,
    kycPassedAt: invoice.kycRequired ? at : null,
    events,
  };
}

/** Строка ленты об оплате мимо сервиса — по ней же узнаётся такой счёт. */
export const PAID_BY_HAND = 'Отмечен оплаченным: деньги получены мимо сервиса';

/** Мерчант сам отметил оплату: деньги пришли мимо сервиса, наличными или переводом. */
export function paidByHand(invoice: MockInvoice, at: Date): MockInvoice {
  const when = at.toISOString();
  return {
    ...invoice,
    status: 'paid',
    paidAt: when,
    events: [...invoice.events, { at: when, what: PAID_BY_HAND }],
  };
}

/**
 * Что с платежом у провайдера — строка таблицы «Платёж у провайдера» в
 * карточке, как у образца. Это не состояние счёта: счёт, оплаченный
 * мимо сервиса, у провайдера так и остался неоплаченным, и карточка
 * не должна приписывать банку деньги, которых он не видел.
 */
export function providerState(invoice: MockInvoice): string {
  switch (invoice.status) {
    case 'issued':
      return 'QR создан';
    case 'expired':
      return 'Истёк';
    case 'cancelled':
      return 'Отменён';
    case 'paid':
    case 'refunded':
      return invoice.events.some((one) => one.what === PAID_BY_HAND)
        ? 'Не оплачен: деньги пришли мимо'
        : 'Завершён';
  }
}

export function cancelledByHand(invoice: MockInvoice, at: Date): MockInvoice {
  return {
    ...invoice,
    status: 'cancelled',
    events: [...invoice.events, { at: at.toISOString(), what: 'Счёт отменён' }],
  };
}

/**
 * Деньги вернули покупателю целиком — счёт становится возвращённым.
 *
 * Целиком — это когда обещанные возвраты покрыли сумму счёта и каждый
 * из них исполнен: принятый к исполнению возврат ещё не деньги, и счёт,
 * названный возвращённым до того, как банк их отдал, обещал бы
 * покупателю то, чего у него на руках нет. Частичный возврат счёт не
 * меняет — отметка о нём живёт в строке списка (`invoiceMarks`).
 */
export function settleRefunds(
  invoice: MockInvoice,
  refunds: readonly MockRefund[],
  at: Date,
): MockInvoice {
  if (invoice.status !== 'paid') return invoice;
  if (!Money.isZero(refundLeft(invoice, refunds))) return invoice;
  const mine = owedRefunds(refunds).filter((one) => one.invoiceId === invoice.id);
  if (mine.length === 0 || mine.some((one) => one.status !== 'done')) return invoice;
  return {
    ...invoice,
    status: 'refunded',
    events: [
      ...invoice.events,
      { at: at.toISOString(), what: 'Деньги возвращены покупателю целиком' },
    ],
  };
}

export function withNote(invoice: MockInvoice, at: Date, what: string): MockInvoice {
  return { ...invoice, events: [...invoice.events, { at: at.toISOString(), what }] };
}
