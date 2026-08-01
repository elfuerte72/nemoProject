import { cookies } from 'next/headers';
import type { Actor } from '@nemo/core';
import { getCore } from '@/lib/core';
import {
  readToken,
  SESSION_COOKIE,
  sessionSecret,
  SessionError,
} from '@/lib/auth/session';

/**
 * Кто выполняет запрос в админке.
 *
 * Двухступенчатая проверка: подписанная кука говорит, что вход
 * состоялся и не истёк, а обращение в базу — что сотрудник действует до
 * сих пор. Второе обязательно при каждом запросе: увольнение должно
 * закрывать доступ немедленно, а не когда истечёт выданная раньше кука.
 */
export async function requireStaffActor(): Promise<Actor & { type: 'staff' }> {
  const store = await cookies();
  const payload = readToken(store.get(SESSION_COOKIE)?.value, { secret: sessionSecret() });

  if (payload.stage !== 'active') {
    throw new SessionError('Вход не завершён: нужен одноразовый код');
  }

  const session = await getCore().getActiveStaff(payload.staffId);
  return { type: 'staff', staffId: session.staffId, role: session.role };
}
