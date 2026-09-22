import { z } from 'zod';
import { ForbiddenError, InvalidInputError } from '@nemo/core';
import { merchantAbilityComplaint, merchantRoleCan } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { listDirectionRates } from '@/lib/direction-rates';
import { requireTill } from '@/lib/mock/guard';
import { getPosSettings, savePosSettings } from '@/lib/mock/store';
import { publishPos } from '@/lib/pos/bus';
import { checkHiddenCodes, parseMarkupPercent, type PosSettings } from '@/lib/pos/settings';
import { viewer } from '@/lib/reads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Настройки терминала: наценка мерчанта и валюты, которые видят
 * сотрудники.
 *
 * Меняет их владелец — право `pricing` из той же таблицы, по которой
 * отвечают операции ядра: наценка это его деньги, а состав валют — чем
 * торгует его кабинет. Оператор за стойкой в терминале работает
 * (`till`), но почём — не решает.
 *
 * Поле присылается целиком или не присылается вовсе: пришедшая наценка
 * заменяет прежнюю, отсутствующая остаётся. Так одна форма правит
 * одно, не зная о другом.
 */
const bodySchema = z.object({
  markupPercent: z.string().trim().max(10).optional(),
  hiddenCodes: z.array(z.string().trim().min(1).max(16)).max(50).optional(),
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
    if (!parsed.success) throw new InvalidInputError('Настройки заполнены не полностью');
    const body = parsed.data;

    const current = getPosSettings(actor.merchantId);
    let next: PosSettings = current;

    if (body.markupPercent !== undefined) {
      const markup = parseMarkupPercent(body.markupPercent);
      if (!markup.ok) throw new InvalidInputError(markup.complaint);
      next = { ...next, markupBps: markup.bps };
    }

    if (body.hiddenCodes !== undefined) {
      const { directions } = await listDirectionRates(getCore());
      const available = [...new Set(directions.filter((one) => one.fromCode === 'RUB').map((one) => one.toCode))];
      const complaint = checkHiddenCodes(body.hiddenCodes, available);
      if (complaint) throw new InvalidInputError(complaint);
      next = { ...next, hiddenCodes: [...new Set(body.hiddenCodes)] };
    }

    savePosSettings(actor.merchantId, next);
    publishPos(actor.merchantId, { kind: 'settings', id: actor.merchantId });
    return json({ settings: next });
  } catch (error) {
    return errorResponse(error);
  }
}
