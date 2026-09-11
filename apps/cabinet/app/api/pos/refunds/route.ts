import { z } from 'zod';
import { InvalidInputError, NotFoundError } from '@nemo/core';
import { Money } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import type { MockRefund } from '@/lib/invoice-rows';
import { addRefund, findInvoice, replaceInvoice } from '@/lib/mock/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Заявка на возврат — из карточки оплаченного счёта, целиком или
 * частью, с причиной.
 *
 * Решение по ней принимает менеджер, и этой части пока нет: заявка
 * остаётся в состоянии «Ожидает». Рисовать переход, которого никто не
 * делает, значило бы обещать ответ.
 *
 * Комиссия здесь не считается. «Остаётся у вас» — разность суммы счёта
 * и суммы возврата, то есть два числа самого мерчанта; у кого
 * удерживается комиссия сервиса, владелец ещё не назвал, и выдуманный
 * процент читался бы как наш тариф.
 */
const bodySchema = z.object({
  invoiceId: z.string().trim().min(1).max(80),
  amount: z.string().trim().min(1).max(40),
  reason: z.string().trim().min(1).max(500),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new InvalidInputError('Возврат заполнен не полностью');
    const body = parsed.data;

    const invoice = findInvoice(actor.merchantId, body.invoiceId);
    if (!invoice) throw new NotFoundError('Счёт не найден');
    if (invoice.status !== 'paid') {
      throw new InvalidInputError('Возврат заводится по оплаченному счёту');
    }

    const value = Money.amountSchema.safeParse(body.amount.replace(/\s/g, '').replace(',', '.'));
    if (!value.success || Money.isZero(value.data) || Money.isNegative(value.data)) {
      throw new InvalidInputError('Сумма возврата должна быть больше нуля');
    }
    if (Money.compare(value.data, invoice.amount) > 0) {
      throw new InvalidInputError('Возврат больше суммы счёта');
    }

    const full = Money.compare(value.data, invoice.amount) === 0;
    const at = new Date().toISOString();
    const refund: MockRefund = {
      id: `ref_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      code: invoice.code,
      amount: value.data,
      retained: full ? null : Money.subtract(invoice.amount, value.data),
      reason: body.reason,
      status: 'pending',
      createdAt: at,
    };
    addRefund(actor.merchantId, refund);
    // Лента счёта — единственное место, где видно, что по нему заявили
    // возврат: без записи карточка о нём молчала бы.
    replaceInvoice(actor.merchantId, {
      ...invoice,
      events: [...invoice.events, { at, what: `Заявлен возврат: ${body.reason}` }],
    });

    return json({ refund }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
