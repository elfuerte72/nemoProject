import { cookies } from 'next/headers';
import { CoreError, type Actor } from '@nemo/core';
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
/**
 * Отказ во входе — от отказавшей базы или незаданного секрета сессии.
 *
 * Экраны заводят посетителя на страницу входа только по первому: если
 * молча отправлять туда и по второму, оборванная база превратится в
 * бесконечный редирект без единой записи в логе.
 */
export function isAuthRefusal(error: unknown): boolean {
  return error instanceof SessionError || (error instanceof CoreError && error.code === 'forbidden');
}

export async function requireStaffActor(): Promise<Actor & { type: 'staff' }> {
  const store = await cookies();
  const payload = readToken(store.get(SESSION_COOKIE)?.value, { secret: sessionSecret() });

  if (payload.stage !== 'active') {
    throw new SessionError('Вход не завершён: нужен одноразовый код');
  }

  const session = await getCore().getActiveStaff(payload.staffId);
  return { type: 'staff', staffId: session.staffId, role: session.role };
}
