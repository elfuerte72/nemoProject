import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Настройки сервиса: ставки линий, минимальная сумма вывода, наценка,
 * минимальная сумма обмена и срок жизни неоплаченной заявки.
 *
 * Карточек на экране две, а операция одна: настройки — единственная
 * строка, и разделять её правку по маршрутам значило бы заводить два
 * журнальных следа для одного изменения.
 *
 * Право администратора проверяет операция, а не маршрут: маршрут — не
 * единственный способ её вызвать, и правило, повторённое здесь,
 * когда-нибудь разошлось бы с тем, что в ядре.
 */
const settingsSchema = z.object({
  referralLine1Bps: z.number().optional(),
  referralLine2Bps: z.number().optional(),
  // Строкой: денежная величина через `number` теряет точность.
  minWithdrawalAmount: z.string().optional(),
  markupBps: z.number().optional(),
  minExchangeAmount: z.string().optional(),
  unpaidExchangeRequestTtlMinutes: z.number().optional(),
  conciergeRepliesPerClientDaily: z.number().optional(),
  conciergeRepliesDaily: z.number().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = settingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Настройка не распознана');
    }

    const settings = await getCore().updateServiceSettings(actor, {
      referralLine1Bps: parsed.data.referralLine1Bps,
      referralLine2Bps: parsed.data.referralLine2Bps,
      minWithdrawalAmount: parsed.data.minWithdrawalAmount,
      markupBps: parsed.data.markupBps,
      minExchangeAmount: parsed.data.minExchangeAmount,
      unpaidExchangeRequestTtlMinutes: parsed.data.unpaidExchangeRequestTtlMinutes,
      conciergeRepliesPerClientDaily: parsed.data.conciergeRepliesPerClientDaily,
      conciergeRepliesDaily: parsed.data.conciergeRepliesDaily,
    });
    return json({ settings });
  } catch (error) {
    return errorResponse(error);
  }
}
