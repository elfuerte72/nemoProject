'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { LiveEvent, LiveTopic } from '@nemo/core';
import {
  eventConcerns,
  LIVE_REFRESH_MS,
  LIVE_STREAM_PATH,
  shouldRefresh,
} from '@/lib/live';

/**
 * Экран, который перечитывает себя сам: по толчку от сервера и,
 * страховкой, по таймеру.
 *
 * Без разметки: обновление — это поведение, а не элемент. Отметку
 * «данные на» рисует `LiveQueue` поверх этого же.
 *
 * Обновление мягкое — `router.refresh()`: он перерисовывает серверную
 * часть, не размонтируя клиентскую. Набранное в поле поиска или в
 * ответе клиенту остаётся на месте, и это не удача, а условие:
 * перерисовка, уносящая набранное, хуже отсутствия обновления.
 */
export function LiveRefresh({
  /** О чём этот экран. Пусто — только таймер, потока не нужно. */
  topic,
  /** Разговор с одним клиентом: чужие сообщения его не касаются. */
  clientId,
  /** Идёт собственное действие менеджера: обновление поверх него лишнее. */
  busy = false,
  /** Пока в форме на экране набирают, обновление ждёт. */
  typing = false,
}: {
  readonly topic?: LiveTopic | undefined;
  readonly clientId?: string | undefined;
  readonly busy?: boolean;
  readonly typing?: boolean;
}) {
  const router = useRouter();
  /*
   * Состояние экрана живёт ссылкой, а не в зависимостях эффекта: иначе
   * таймер пересоздавался бы на каждую букву — а вместе с ним и
   * соединение с потоком событий, — и обновление не наступало бы вовсе,
   * пока менеджер печатает.
   */
  const state = useRef({ busy, typing });
  state.current = { busy, typing };

  /**
   * Событие, пришедшее в неподходящий момент, не выбрасывается: экран
   * перечитает себя, как только станет можно. Иначе сообщение,
   * пришедшее на скрытую вкладку, ждало бы следующего события — то есть
   * ответа, которого менеджер и не написал, потому что не увидел
   * вопроса.
   */
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

    /*
     * Поток открывается только там, где экрану есть что слушать.
     * `EventSource` сам переподключается после обрыва — за паузу между
     * попытками отвечает таймер выше.
     */
    const source = topic ? new EventSource(LIVE_STREAM_PATH) : undefined;
    if (source && topic) {
      const screen = { topic, ...(clientId ? { clientId } : {}) };
      source.addEventListener('message', (message: MessageEvent<string>) => {
        let event: LiveEvent;
        try {
          event = JSON.parse(message.data) as LiveEvent;
        } catch {
          return;
        }
        if (eventConcerns(event, screen)) refresh();
      });
    }

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      source?.close();
    };
  }, [router, topic, clientId]);

  return null;
}
