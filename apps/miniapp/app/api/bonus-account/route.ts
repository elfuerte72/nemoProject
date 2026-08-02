import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Реферальный кабинет: баланс, размер сети и история начислений. */
export async function GET(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const account = await getCore().getBonusAccount({
      type: 'client',
      telegramUserId: initData.telegramUserId,
    });
    return json({ account });
  } catch (error) {
    return errorResponse(error);
  }
}
