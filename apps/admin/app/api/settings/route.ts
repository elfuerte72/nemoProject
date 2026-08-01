import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Настройки сервиса: ставки линий, минимальная сумма вывода, наценки по
 * направлениям.
 *
 * Право администратора проверяет операция, а не маршрут: маршрут — не
 * единственный способ её вызвать, и правило, повторённое здесь,
 * когда-нибудь разошлось бы с тем, что в ядре.
 */
const settingsSchema = z.discriminatedUnion('subject', [
  z.object({
    subject: z.literal('service'),
    referralLine1Bps: z.number().optional(),
    referralLine2Bps: z.number().optional(),
    // Строкой: денежная величина через `number` теряет точность.
    minWithdrawalAmount: z.string().optional(),
  }),
  z.object({
    subject: z.literal('currency-pair'),
    pairId: z.string().uuid(),
    markupBps: z.number(),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = settingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Настройка не распознана');
    }
    const core = getCore();

    if (parsed.data.subject === 'currency-pair') {
      const pair = await core.updateCurrencyPairMarkup(
        actor,
        parsed.data.pairId,
        parsed.data.markupBps,
      );
      return json({ pair });
    }

    const settings = await core.updateServiceSettings(actor, {
      referralLine1Bps: parsed.data.referralLine1Bps,
      referralLine2Bps: parsed.data.referralLine2Bps,
      minWithdrawalAmount: parsed.data.minWithdrawalAmount,
    });
    return json({ settings });
  } catch (error) {
    return errorResponse(error);
  }
}
