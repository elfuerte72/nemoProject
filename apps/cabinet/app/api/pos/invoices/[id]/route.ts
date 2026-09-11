import { z } from 'zod';
import { InvalidInputError, NotFoundError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/lib/invoice-rows';
import { findInvoice, replaceInvoice } from '@/lib/mock/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Что мерчант делает со своим счётом: отмечает оплаченным или
 * отменяет.
 *
 * Оплату отмечает он, а не сервис: денег покупателя мы не принимаем и
 * проверить их не можем. Кнопка так и называется — это его учёт, а не
 * наш факт.
 *
 * Отмеченный однажды счёт назад не переводится: отметка — событие, и
 * лента, из которой его можно стереть, перестаёт быть историей.
 */
const bodySchema = z.object({ status: z.enum(['paid', 'cancelled']) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new InvalidInputError('Неизвестное действие со счётом');
    const status: InvoiceStatus = parsed.data.status;

    const invoice = findInvoice(actor.merchantId, id);
    if (!invoice) throw new NotFoundError('Счёт не найден');
    if (invoice.status !== 'issued') {
      throw new InvalidInputError(
        `Счёт уже ${INVOICE_STATUS_LABELS[invoice.status].toLowerCase()}`,
      );
    }

    const at = new Date().toISOString();
    const next = {
      ...invoice,
      status,
      paidAt: status === 'paid' ? at : null,
      events: [
        ...invoice.events,
        {
          at,
          what:
            status === 'paid'
              ? 'Отмечен оплаченным: деньги получены мимо сервиса'
              : 'Счёт отменён',
        },
      ],
    };
    replaceInvoice(actor.merchantId, next);

    return json({ invoice: next });
  } catch (error) {
    return errorResponse(error);
  }
}
