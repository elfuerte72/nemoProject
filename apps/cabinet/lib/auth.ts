import { cookies } from 'next/headers';
import { CoreError, type Actor, type MerchantSession } from '@nemo/core';
import { getCore } from '@/lib/core';
import { readToken, SESSION_COOKIE, sessionSecret, SessionError } from '@/lib/session';

export type MerchantActor = Actor & { type: 'merchant' };

/** Кто смотрит: актор для операций и сама сессия для оболочки кабинета. */
export interface MerchantViewer {
  readonly actor: MerchantActor;
  readonly session: MerchantSession;
}

/**
 * Кто выполняет запрос в кабинете.
 *
 * Две ступени: подписанная кука говорит, что вход состоялся и не истёк,
 * а обращение в базу — что поколение то же и мерчант всё ещё тот, за
 * кого себя выдаёт. Второе обязательно при каждом запросе: смена пароля
 * обрывает сессии немедленно, а не когда истечёт выданная раньше кука.
 *
 * Состояние мерчанта здесь не проверяется: отклонённый и отключённый в
 * кабинет входят — первому надо прочитать причину, второму дождаться
 * своих открытых заявок. Что им можно делать, решают операции ядра.
 */
export async function requireViewer(): Promise<MerchantViewer> {
  const store = await cookies();
  const payload = readToken(store.get(SESSION_COOKIE)?.value, { secret: sessionSecret() });

  const session = await getCore().getMerchantSession(payload.merchantId, payload.sessionEpoch);
  return { actor: { type: 'merchant', merchantId: session.merchantId }, session };
}

export async function requireActor(): Promise<MerchantActor> {
  return (await requireViewer()).actor;
}

/**
 * То же для экранов: `null` означает «нужно войти».
 *
 * `null` возвращается только на отказ во входе — нет куки, кука
 * истекла, поколение сменилось. Всё остальное — незаданный секрет
 * сессии, отказавшая база — пробрасывается: молча отправлять и такое на
 * страницу входа значит превращать аварию в бесконечный редирект, о
 * котором никто не узнает.
 */
export async function requireViewerOrNull(): Promise<MerchantViewer | null> {
  try {
    return await requireViewer();
  } catch (error) {
    if (error instanceof SessionError) return null;
    if (error instanceof CoreError && error.code === 'forbidden') return null;
    throw error;
  }
}
