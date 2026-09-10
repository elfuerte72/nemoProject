import { cookies } from 'next/headers';
import { json } from '@/lib/api';
import { AMBASSADOR_COOKIE } from '@/lib/ambassador-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Выход амбассадора. Снимается только его кука: с одной машины иногда
 * работают оба кабинета, и выход из одного не должен выбрасывать из
 * другого.
 */
export async function POST(): Promise<Response> {
  (await cookies()).delete(AMBASSADOR_COOKIE);
  return json({ ok: true });
}
