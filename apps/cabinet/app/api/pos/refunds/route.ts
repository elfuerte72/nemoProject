import { z } from 'zod';
import { InvalidInputError, NotFoundError } from '@nemo/core';
import { Money } from '@nemo/types';
import { formatMoney } from '@nemo/ui/format';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { refundLeft, type MockRefund } from '@/lib/invoice-rows';
import { requireTill } from '@/lib/mock/guard';
import { addRefund, findInvoice, listRefunds, replaceInvoice } from '@/lib/mock/store';
import { viewer } from '@/lib/reads';

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
    const { session } = await viewer();
    requireTill(session);
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
    /*
     * Считается от остатка, а не от суммы счёта: заявленное раньше уже
     * ушло покупателю. Без этого двойное нажатие клало бы в очередь два
     * полных возврата по одному счёту, и «к возврату» показывало бы
     * вдвое больше, чем по нему вообще платили.
     */
    const left = refundLeft(invoice, listRefunds(actor.merchantId));
    if (Money.isZero(left)) {
      throw new InvalidInputError('По этому счёту возврат уже заявлен целиком');
    }
    if (Money.compare(value.data, left) > 0) {
      throw new InvalidInputError(
        `Больше остатка: по счёту можно вернуть ещё ${formatMoney(left, invoice.code)}`,
      );
    }

    const full = Money.compare(value.data, left) === 0;
    const at = new Date().toISOString();
    const refund: MockRefund = {
      id: `ref_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      code: invoice.code,
      amount: value.data,
      retained: full ? null : Money.subtract(left, value.data),
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
