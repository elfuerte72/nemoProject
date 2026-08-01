import { cookies } from 'next/headers';
import { json } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return json({ ok: true });
}
