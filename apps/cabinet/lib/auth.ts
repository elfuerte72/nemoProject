import { cookies } from 'next/headers';
import type { Actor, MerchantSession } from '@nemo/core';
import { getCore } from '@/lib/core';
import { readToken, SESSION_COOKIE, sessionSecret, viewerOrElse } from '@/lib/session';

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
 * Тот же вход, но с `null` вместо отказа — для страницы входа: `null`
 * значит «показать форму», а вошедшего она отправляет в кабинет.
 * Разделам кабинета это не годится: им без сессии нужно на вход, и
 * читают они через `viewer` из `lib/reads.ts` — поверх памяти запроса,
 * иначе каркас и раздел под ним ходили бы за сессией дважды.
 */
export async function viewerOrNull(): Promise<MerchantViewer | null> {
  return viewerOrElse(requireViewer, () => null);
}
