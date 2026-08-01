import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { botToken, deliverNotifications } from '@nemo/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Действия менеджера над заявкой.
 *
 * Один маршрут на все переходы, а не по маршруту на каждый: решение о
 * том, какие переходы существуют и кому разрешены, принимает операция,
 * и разносить его ещё и по адресам значило бы описывать таблицу
 * состояний дважды.
 */

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim') }),
  z.object({
    action: z.literal('confirm-rate'),
    finalRate: z.string(),
    toAmount: z.string().optional(),
    paymentInstructions: z.string(),
  }),
  z.object({ action: z.literal('payment-received') }),
  z.object({
    action: z.literal('complete'),
    serviceIncome: z.string(),
    serviceIncomeCode: z.string(),
  }),
  z.object({ action: z.literal('cancel'), reason: z.string() }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const { id } = await context.params;

    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Действие не распознано');
    }
    const input = parsed.data;
    const core = getCore();

    const result = await (async () => {
      switch (input.action) {
        case 'claim':
          return core.claimExchangeRequest(actor, id);
        case 'confirm-rate':
          return core.confirmExchangeRate(actor, id, {
            finalRate: input.finalRate,
            toAmount: input.toAmount,
            paymentInstructions: input.paymentInstructions,
          });
        case 'payment-received':
          return core.markPaymentReceived(actor, id);
        case 'complete':
          return core.completeExchangeRequest(actor, id, {
            serviceIncome: input.serviceIncome,
            serviceIncomeCode: input.serviceIncomeCode,
          });
        case 'cancel':
          return core.cancelExchangeRequest(actor, id, { reason: input.reason });
      }
    })();

    await deliverNotifications(result.notifications, { botToken: botToken() });
    return json({ request: result.request });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const { id } = await context.params;
    const core = getCore();

    const [request, events] = await Promise.all([
      core.getExchangeRequestForStaff(actor, id),
      core.listExchangeRequestEvents(actor, id),
    ]);
    return json({ request, events });
  } catch (error) {
    return errorResponse(error);
  }
}
