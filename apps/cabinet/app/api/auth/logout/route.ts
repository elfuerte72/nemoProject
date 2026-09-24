import { cookies } from 'next/headers';
import { json } from '@/lib/api';
import { getCore } from '@/lib/core';
import { readToken, SESSION_COOKIE, SessionError, sessionSecret } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Выход: кука снимается, а запись о входе гасится — скопированная кука
 * после выхода не пускает. До 24 сентября 2026 выход только снимал
 * куку, и её копия жила свои тридцать дней.
 *
 * Отказ базы выход не срывает: выходящему важнее выйти, чем узнать, что
 * запись не погасла, — она истечёт сроком.
 */
export async function POST(): Promise<Response> {
  const store = await cookies();
  try {
    const payload = readToken(store.get(SESSION_COOKIE)?.value, { secret: sessionSecret() });
    await getCore().endMerchantSession(payload.userId, payload.sessionId);
  } catch (error) {
    if (!(error instanceof SessionError)) {
      console.error('Не удалось погасить сессию при выходе', error);
    }
  }
  store.delete(SESSION_COOKIE);
  return json({ ok: true });
}
