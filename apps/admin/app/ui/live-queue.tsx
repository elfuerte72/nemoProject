'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { LIVE_REFRESH_MS, shouldRefresh } from '@/lib/live';
import { Moment } from '@/app/ui/moment';

/**
 * Очередь, которая обновляется сама, и отметка о том, когда её видели.
 *
 * Менеджер сидит на экране и ждёт работу: без обновления новая заявка
 * появлялась бы только после перезагрузки, а счётчики в меню застывали
 * бы на числах начала смены.
 *
 * Обновление мягкое — `router.refresh()`: он перерисовывает серверную
 * часть, не размонтируя клиентскую. Набранное в поле поиска остаётся на
 * месте, и это не удача, а условие: перерисовка, уносящая набранное,
 * хуже отсутствия обновления.
 *
 * Отметка времени говорит, на какой момент показанное верно. Без неё
 * «заявок нет» неотличимо от «экран открыт со вчера».
 */
export function LiveQueue({
  fetchedAt,
  /** Идёт собственное действие менеджера: обновление поверх него лишнее. */
  busy = false,
  /** Пока в форме на экране набирают, обновление ждёт. */
  typing = false,
}: {
  readonly fetchedAt: string;
  readonly busy?: boolean;
  readonly typing?: boolean;
}) {
  const router = useRouter();
  /*
   * Состояние экрана живёт ссылкой, а не в зависимостях эффекта: иначе
   * таймер пересоздавался бы на каждую букву, и обновление не наступало
   * бы вовсе, пока менеджер печатает.
   */
  const state = useRef({ busy, typing });
  state.current = { busy, typing };

  useEffect(() => {
    const timer = setInterval(() => {
      if (
        shouldRefresh({
          hidden: document.visibilityState === 'hidden',
          busy: state.current.busy,
          typing: state.current.typing,
        })
      ) {
        router.refresh();
      }
    }, LIVE_REFRESH_MS);

    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="stamp">
      <span className="stamp__text">
        Данные на <Moment at={fetchedAt} />
      </span>
      {/*
        Кнопка не гаснет на время обновления: погашенная теряет фокус, и
        работающий с клавиатуры оказывается в начале страницы. Ответ
        виден по самой отметке времени — она и есть подтверждение.
      */}
      <button type="button" className="btn btn--ghost btn--tiny" onClick={() => router.refresh()}>
        Обновить
      </button>
    </div>
  );
}
