import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Обезличенный список рефералов: `line`, `offset`, `limit`. */
export async function GET(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const url = new URL(request.url);
    const line = url.searchParams.get('line');
    const offset = url.searchParams.get('offset');
    const limit = url.searchParams.get('limit');
    const page = await getCore().listMyReferrals(
      { type: 'client', telegramUserId: initData.telegramUserId },
      {
        line: line === null ? undefined : Number(line),
        offset: offset === null ? undefined : Number(offset),
        limit: limit === null ? undefined : Number(limit),
      },
    );
    return json({ page });
  } catch (error) {
    return errorResponse(error);
  }
}
