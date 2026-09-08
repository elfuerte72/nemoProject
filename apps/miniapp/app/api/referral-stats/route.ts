import { InvalidInputError } from '@nemo/core';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Сводка реферального кабинета за период: `from` и `to` — моменты ISO,
 * `offset` — смещение пояса смотрящего в минутах. Границы периода и
 * смещение проверяет операция; маршрут лишь разбирает строки.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const url = new URL(request.url);
    const from = new Date(url.searchParams.get('from') ?? '');
    const to = new Date(url.searchParams.get('to') ?? '');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new InvalidInputError('Период задаётся двумя моментами');
    }
    const offset = url.searchParams.get('offset');
    const stats = await getCore().summarizeReferralCabinet(
      { type: 'client', telegramUserId: initData.telegramUserId },
      { from, to },
      { offsetMinutes: offset === null ? undefined : Number(offset) },
    );
    return json({ stats });
  } catch (error) {
    return errorResponse(error);
  }
}
