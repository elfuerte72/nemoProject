import { z } from 'zod';
import { InvalidInputError, NotFoundError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { INVOICE_STATUS_LABELS } from '@/lib/invoice-rows';
import { requireTill } from '@/lib/mock/guard';
import { findInvoice, replaceInvoice } from '@/lib/mock/store';
import { acquirer } from '@/lib/pos/acquirer';
import { publishPos } from '@/lib/pos/bus';
import { cancelledByHand, isPayable, paidByHand } from '@/lib/pos/lifecycle';
import { viewer } from '@/lib/reads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Счёт для экрана терминала: сам счёт, действующий QR и часы сервера.
 *
 * Часы — чтобы обратный отсчёт на экране шёл от одного времени с
 * сервером: планшет у стойки может отставать на минуты, и «QR обновится
 * через 0:00» висел бы на нём, пока сервер уже выпустил следующий.
 * QR отдаётся только тому счёту, который ещё ждёт денег.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const now = new Date();
    const invoice = findInvoice(actor.merchantId, id, now);
    if (!invoice) throw new NotFoundError('Счёт не найден');
    const qr =
      invoice.payment && isPayable(invoice, now)
        ? await acquirer().qr(invoice.payment.ref, now)
        : null;
    return json({ invoice, qr, now: now.toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Что мерчант делает со своим счётом руками: отмечает оплаченным или
 * отменяет.
 *
 * Отметка руками осталась рядом с провайдером: покупатель может
 * расплатиться мимо него — наличными у стойки, — и счёт при этом
 * закрывается по слову мерчанта. Лента говорит, чем именно.
 *
 * Отмена сообщается провайдеру: у банка после неё QR перестаёт
 * приниматься. Закрытый однажды счёт назад не переводится: отметка —
 * событие, и лента, из которой его можно стереть, перестаёт быть
 * историей.
 */
const bodySchema = z.object({ status: z.enum(['paid', 'cancelled']) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { session } = await viewer();
    requireTill(session);
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new InvalidInputError('Неизвестное действие со счётом');

    const at = new Date();
    const invoice = findInvoice(actor.merchantId, id, at);
    if (!invoice) throw new NotFoundError('Счёт не найден');
    if (!isPayable(invoice, at)) {
      throw new InvalidInputError(
        `Счёт уже ${INVOICE_STATUS_LABELS[invoice.status].toLowerCase()}`,
      );
    }

    const next =
      parsed.data.status === 'paid' ? paidByHand(invoice, at) : cancelledByHand(invoice, at);
    if (parsed.data.status === 'cancelled' && invoice.payment) {
      await acquirer().cancel(invoice.payment.ref, at);
    }
    replaceInvoice(actor.merchantId, next);
    publishPos(actor.merchantId, { kind: 'invoice', id: next.id });

    return json({ invoice: next, qr: null, now: at.toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
