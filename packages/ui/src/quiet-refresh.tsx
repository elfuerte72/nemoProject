'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { LIVE_REFRESH_MS, shouldRefresh } from './live.js';

/**
 * Экран, который перечитывает себя сам по таймеру, пока вкладка видна.
 *
 * Без разметки: обновление — это поведение, а не элемент. Обновление
 * мягкое (`router.refresh()`): перерисовывается серверная часть, а
 * клиентская не размонтируется — набранное в форме остаётся на месте, и
 * это условие, а не удача.
 *
 * Момент, пришедший не вовремя, не выбрасывается: экран перечитает себя,
 * как только станет можно. Иначе то, что случилось на скрытой вкладке,
 * ждало бы следующего срабатывания таймера — то есть ещё полминуты
 * после возвращения.
 */
export function QuietRefresh({
  /** Идёт собственное действие человека: обновление поверх него лишнее. */
  busy = false,
  /** Пока в форме на экране набирают, обновление ждёт. */
  typing = false,
}: {
  readonly busy?: boolean;
  readonly typing?: boolean;
}) {
  const router = useRouter();
  /*
   * Состояние живёт ссылкой, а не в зависимостях эффекта: иначе таймер
   * пересоздавался бы на каждую букву, и обновление не наступало бы
   * вовсе, пока в форме печатают.
   */
  const state = useRef({ busy, typing });
  state.current = { busy, typing };
  const pending = useRef(false);

  useEffect(() => {
    const refresh = (): void => {
      if (
        !shouldRefresh({
          hidden: document.visibilityState === 'hidden',
          busy: state.current.busy,
          typing: state.current.typing,
        })
      ) {
        pending.current = true;
        return;
      }
      pending.current = false;
      router.refresh();
    };

    const timer = setInterval(refresh, LIVE_REFRESH_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && pending.current) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}
