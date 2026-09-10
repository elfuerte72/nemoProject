import { cookies } from 'next/headers';
import type { Actor, AmbassadorSession } from '@nemo/core';
import { isCoreError } from '@nemo/http';
import { getCore } from '@/lib/core';
import { AMBASSADOR_COOKIE, readAmbassadorToken } from '@/lib/ambassador-session';
import { SessionError, sessionSecret, viewerOrElse } from '@/lib/session';

/**
 * Кто смотрит кабинет амбассадора.
 *
 * Собирается здесь третий путь к клиентскому `Actor` — рядом с
 * подписью запуска Mini App и ключом API мерчанта. В `actor.ts`
 * записано, что собрать актора из непроверенного запроса — ошибка
 * адаптера, которую ничем, кроме внимательности, не поймать; оба
 * прежних пути под тестом, и этот тоже (`ambassador.test.ts`).
 *
 * Ступеней две, как у мерчанта: подписанная кука говорит, что вход
 * состоялся и не истёк, а обращение к ядру — что отметка на месте и не
 * снята. Второе обязательно при каждом запросе: снятие закрывает вход
 * немедленно, а не когда истечёт выданная раньше кука.
 */

export type ClientActor = Actor & { type: 'client' };

export interface AmbassadorViewer {
  readonly actor: ClientActor;
  readonly session: AmbassadorSession;
}

export async function requireAmbassador(): Promise<AmbassadorViewer> {
  const store = await cookies();
  const { clientId } = readAmbassadorToken(store.get(AMBASSADOR_COOKIE)?.value, {
    secret: sessionSecret(),
  });

  // Право входа решает ядро: кука подтверждает только сам вход.
  const session = await getCore().signInAmbassador(clientId);
  return { actor: { type: 'client', telegramUserId: session.clientId }, session };
}

/**
 * Чем кабинет отвечает на отказ чтения.
 *
 * «Не вошёл» и «вошёл, но не в программе» — разные состояния, и одним
 * экраном на них не ответить: первому нужна дверь, а отказ «вас нет в
 * программе» не говорит, куда нажимать. Чужая ошибка не подменяется
 * ничем — страница аварии честнее выдуманного объяснения.
 */
export function ambassadorScreen(error: unknown): 'entry' | 'not-in-program' | null {
  if (error instanceof SessionError) return 'entry';
  if (isCoreError(error) && error.code === 'forbidden') return 'not-in-program';
  return null;
}

/** Тот же вход, но с `null` вместо отказа — витрине и странице входа. */
export async function ambassadorOrNull(): Promise<AmbassadorViewer | null> {
  return viewerOrElse(requireAmbassador, () => null);
}
