'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { FallbackFrame, type FallbackHome, type FallbackStandalone } from './fallback.js';

/**
 * «Страница не открылась» — граница ошибок `error.tsx` панели и кабинета.
 *
 * Говорит, что сбой на стороне сервиса, а не в том, что человек нажал,
 * и даёт два выхода: попробовать ещё раз и уйти туда, где работа
 * продолжается. Повтор перечитывает страницу с сервера (`router.refresh`)
 * и только потом снимает границу: без перечитывания `reset` снова
 * показал бы то, что уже упало.
 *
 * Код ошибки — отпечаток, под которым сервер записал её в журнал. Текста
 * ошибки на экране нет: в нём может оказаться что угодно, вплоть до
 * строки подключения к базе.
 */
export function ErrorScreen({
  error,
  reset,
  home,
  help,
  standalone,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
  readonly home: FallbackHome;
  /** Кого звать, если повтор не помогает: разработчика или поддержку. */
  readonly help: string;
  readonly standalone?: FallbackStandalone | undefined;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <FallbackFrame
      icon="question"
      title="Страница не открылась"
      text={`Сбой на нашей стороне. Попробуйте ещё раз через минуту, а если не проходит, ${help}.`}
      note={
        error.digest ? (
          <p className="fallback__code">
            Код ошибки: <span className="mono">{error.digest}</span>
          </p>
        ) : undefined
      }
      actions={
        <>
          <button
            type="button"
            className="btn btn--soft"
            disabled={pending}
            onClick={() =>
              startTransition(() => {
                router.refresh();
                reset();
              })
            }
          >
            {pending ? 'Открываем…' : 'Попробовать ещё раз'}
          </button>
          <Link className="btn btn--ghost" href={home.href}>
            {home.label}
          </Link>
        </>
      }
      standalone={standalone}
    />
  );
}
