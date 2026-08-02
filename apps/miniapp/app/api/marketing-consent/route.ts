import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Согласие на рассылку: клиент отвечает при первом входе и может
 * передумать в любой момент. Отдельным маршрутом, а не полем профиля,
 * потому что отписка должна быть одним действием, а не сохранением
 * формы.
 */

const consentSchema = z.object({ consent: z.boolean() });

export async function POST(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const parsed = consentSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Не понят ответ о согласии на рассылку');
    }

    const { marketingConsent } = await getCore().setMarketingConsent(
      { type: 'client', telegramUserId: initData.telegramUserId },
      parsed.data.consent,
    );
    return json({ marketingConsent });
  } catch (error) {
    return errorResponse(error);
  }
}
