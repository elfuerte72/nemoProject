import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { botToken, deliverNotifications } from '@nemo/telegram';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ code: z.string().max(100) });

/**
 * Чужой промокод после регистрации. Кому можно — решает операция: нет
 * реферера и нет заявок (docs/adr/0019). Уведомление рефереру уходит
 * тем же путём, что при регистрации по ссылке.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Введите промокод');
    }
    const core = getCore();
    const result = await core.bindReferrerByPromoCode(
      { type: 'client', telegramUserId: initData.telegramUserId },
      parsed.data.code,
    );
    await deliverNotifications(result.notifications, { botToken: botToken() });
    return json({ client: result.client });
  } catch (error) {
    return errorResponse(error);
  }
}
