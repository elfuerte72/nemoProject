import { cookies } from 'next/headers';
import { errorResponse, json } from '@/lib/api';
import { requireViewer } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { SESSION_COOKIE } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Отключить одну свою сессию. Своя текущая — это выход: кука снимается
 * здесь же, иначе следующий экран узнал бы об отключении отказом.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { actor, session } = await requireViewer();
    const { id } = await context.params;

    await getCore().revokeMerchantSession(actor, id);

    const signedOut = id === session.sessionId;
    if (signedOut) (await cookies()).delete(SESSION_COOKIE);
    return json({ signedOut });
  } catch (error) {
    return errorResponse(error);
  }
}
