import { InvalidInputError, NotFoundError } from '@nemo/core';
import { INVOICE_STATUS_LABELS, type MockInvoice } from '../invoice-rows';
import { findInvoice, replaceInvoice } from '../mock/store';
import { publishPos } from './bus';
import { isPayable, paidByProvider } from './lifecycle';

/**
 * Провайдер сообщил об оплате — одна точка на всех провайдеров.
 *
 * Сюда придёт вебхук банка, когда он появится; сегодня сюда приходит
 * кнопка имитации. Всё, что делается по факту оплаты, — переход счёта,
 * запись в ленту, толчок открытым вкладкам, — живёт здесь один раз, и
 * банк, встав на место имитации, не заведёт второго пути к тому же.
 *
 * Сообщение о чужом или закрытом счёте — отказ словами, а не молчание:
 * провайдер, которому ответили «принято» на уже оплаченный счёт, будет
 * считать, что деньги учтены дважды.
 */
export interface PaymentNotice {
  readonly provider: string;
  readonly providerTitle: string;
  readonly at: Date;
}

export function acceptPayment(
  merchantId: string,
  invoiceId: string,
  notice: PaymentNotice,
): MockInvoice {
  const invoice = findInvoice(merchantId, invoiceId, notice.at);
  if (!invoice) throw new NotFoundError('Счёт не найден');
  if (!isPayable(invoice, notice.at)) {
    throw new InvalidInputError(`Счёт уже ${INVOICE_STATUS_LABELS[invoice.status].toLowerCase()}`);
  }
  if (invoice.payment?.provider !== notice.provider) {
    throw new InvalidInputError('Этот счёт выставлен через другого провайдера');
  }
  const next = paidByProvider(invoice, { at: notice.at, providerTitle: notice.providerTitle });
  replaceInvoice(merchantId, next);
  publishPos(merchantId, { kind: 'invoice', id: next.id });
  return next;
}
