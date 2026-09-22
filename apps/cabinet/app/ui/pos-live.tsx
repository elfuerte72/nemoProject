'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { LIVE_REFRESH_MS, shouldRefresh } from '@nemo/ui';
import { POS_STREAM_PATH } from '@/lib/pos/stream';

/**
 * Экран терминала, который перечитывает себя сам: по толчку из потока
 * событий POS и, страховкой, по таймеру.
 *
 * Тот же приём, что у панели (docs/adr/0014) и у тихого обновления
 * остальных разделов кабинета: обновление мягкое, `router.refresh()`
 * перерисовывает серверную часть и не размонтирует клиентскую, так что
 * набранное в форме возврата остаётся на месте.
 *
 * Событие, пришедшее на скрытую вкладку или посреди набора, не
 * выбрасывается: экран перечитает себя, как только станет можно.
 */
export function PosLive({
  busy = false,
  typing = false,
}: {
  readonly busy?: boolean;
  readonly typing?: boolean;
}) {
  const router = useRouter();
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

    // `EventSource` переподключается после обрыва сам; за паузу между
    // попытками отвечает таймер выше.
    const source = new EventSource(POS_STREAM_PATH);
    source.addEventListener('message', refresh);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      source.close();
    };
  }, [router]);

  return null;
}
