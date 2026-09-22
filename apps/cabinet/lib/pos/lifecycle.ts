import type { MockInvoice } from '../invoice-rows';

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

/** Мерчант сам отметил оплату: деньги пришли мимо сервиса, наличными или переводом. */
export function paidByHand(invoice: MockInvoice, at: Date): MockInvoice {
  const when = at.toISOString();
  return {
    ...invoice,
    status: 'paid',
    paidAt: when,
    events: [...invoice.events, { at: when, what: 'Отмечен оплаченным: деньги получены мимо сервиса' }],
  };
}

export function cancelledByHand(invoice: MockInvoice, at: Date): MockInvoice {
  return {
    ...invoice,
    status: 'cancelled',
    events: [...invoice.events, { at: at.toISOString(), what: 'Счёт отменён' }],
  };
}

export function withNote(invoice: MockInvoice, at: Date, what: string): MockInvoice {
  return { ...invoice, events: [...invoice.events, { at: at.toISOString(), what }] };
}
