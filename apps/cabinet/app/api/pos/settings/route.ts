import { z } from 'zod';
import { ForbiddenError, InvalidInputError } from '@nemo/core';
import { merchantAbilityComplaint, merchantRoleCan } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { requireTill } from '@/lib/mock/guard';
import { getPosSettings, savePosSettings } from '@/lib/mock/store';
import { publishPos } from '@/lib/pos/bus';
import { parseMarkupPercent, type PosSettings } from '@/lib/pos/settings';
import { viewer } from '@/lib/reads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Настройка терминала: наценка мерчанта.
 *
 * Меняет её владелец — право `pricing` из той же таблицы, по которой
 * отвечают операции ядра: наценка это его деньги. Оператор за стойкой
 * в терминале работает (`till`), но почём — не решает. Форма живёт в
 * разделе «Настройки» кабинета, а маршрут остался у терминала: это
 * его настройка, и переедет она в базу вместе со счетами.
 */
const bodySchema = z.object({
  markupPercent: z.string().trim().max(10),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const { session } = await viewer();
    requireTill(session);
    if (!merchantRoleCan(session.role, 'pricing')) {
      throw new ForbiddenError(merchantAbilityComplaint('pricing'));
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new InvalidInputError('Наценка не заполнена');

    const markup = parseMarkupPercent(parsed.data.markupPercent);
    if (!markup.ok) throw new InvalidInputError(markup.complaint);

    const next: PosSettings = { ...getPosSettings(actor.merchantId), markupBps: markup.bps };
    savePosSettings(actor.merchantId, next);
    publishPos(actor.merchantId, { kind: 'settings', id: actor.merchantId });
    return json({ settings: next });
  } catch (error) {
    return errorResponse(error);
  }
}
