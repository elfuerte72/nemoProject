import { errorResponse, json } from '@/lib/api';
import { requireViewer } from '@/lib/auth';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Отключить все свои сессии, кроме этой: увидел незнакомое устройство —
 * выключил всё чужое, не выходя сам. Какая «эта», говорит кука, а не
 * тело запроса: оставить себе чужую сессию так нельзя.
 */
export async function POST(): Promise<Response> {
  try {
    const { actor, session } = await requireViewer();
    const revoked = await getCore().revokeOtherMerchantSessions(actor, session.sessionId);
    return json({ revoked });
  } catch (error) {
    return errorResponse(error);
  }
}
