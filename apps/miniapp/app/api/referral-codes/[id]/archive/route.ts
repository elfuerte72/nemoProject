import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Архив кода: из списка он пропадает, приведённые им остаются с отметкой. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const { id } = await context.params;
    await getCore().archiveReferralCode(
      { type: 'client', telegramUserId: initData.telegramUserId },
      id,
    );
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
