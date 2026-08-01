import { cookies } from 'next/headers';
import { CoreError, type Actor } from '@nemo/core';
import { getCore } from '@/lib/core';
import { readToken, SESSION_COOKIE, sessionSecret, SessionError } from '@/lib/auth/session';

export type StaffActor = Actor & { type: 'staff' };

/**
 * Кто выполняет запрос в админке.
 *
 * Двухступенчатая проверка: подписанная кука говорит, что вход
 * состоялся и не истёк, а обращение в базу — что сотрудник действует до
 * сих пор. Второе обязательно при каждом запросе: увольнение должно
 * закрывать доступ немедленно, а не когда истечёт выданная раньше кука.
 */
export async function requireStaffActor(): Promise<StaffActor> {
  const store = await cookies();
  const payload = readToken(store.get(SESSION_COOKIE)?.value, { secret: sessionSecret() });

  if (payload.stage !== 'active') {
    throw new SessionError('Вход не завершён: нужен одноразовый код');
  }

  const session = await getCore().getActiveStaff(payload.staffId);
  return { type: 'staff', staffId: session.staffId, role: session.role };
}

/**
 * То же, но для экранов: `null` означает «нужно войти».
 *
 * `null` возвращается только на отказ во входе — нет куки, кука
 * истекла, сотрудник отключён. Всё остальное — незаданный секрет
 * сессии, отказавшая база — пробрасывается: молча отправлять и такое
 * на страницу входа значит превращать аварию в бесконечный редирект,
 * о котором никто не узнает.
 */
export async function requireStaffActorOrNull(): Promise<StaffActor | null> {
  try {
    return await requireStaffActor();
  } catch (error) {
    if (error instanceof SessionError) return null;
    if (error instanceof CoreError && error.code === 'forbidden') return null;
    throw error;
  }
}
