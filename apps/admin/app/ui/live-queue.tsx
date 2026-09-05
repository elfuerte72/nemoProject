'use client';

import { useRouter } from 'next/navigation';
import type { LiveTopic } from '@nemo/core';
import { LiveRefresh } from '@/app/ui/live-refresh';
import { Moment } from '@/app/ui/moment';

/**
 * Очередь, которая обновляется сама, и отметка о том, когда её видели.
 *
 * Менеджер сидит на экране и ждёт работу: без обновления новая заявка
 * появлялась бы только после перезагрузки, а счётчики в меню застывали
 * бы на числах начала смены. Само обновление — в `LiveRefresh`: толчок
 * от сервера и таймер вслед за ним.
 *
 * Отметка времени говорит, на какой момент показанное верно. Без неё
 * «заявок нет» неотличимо от «экран открыт со вчера».
 */
export function LiveQueue({
  fetchedAt,
  /** О чём этот экран: по теме он и слышит события. */
  topic,
  /** Идёт собственное действие менеджера: обновление поверх него лишнее. */
  busy = false,
  /** Пока в форме на экране набирают, обновление ждёт. */
  typing = false,
}: {
  readonly fetchedAt: string;
  readonly topic?: LiveTopic | undefined;
  readonly busy?: boolean;
  readonly typing?: boolean;
}) {
  const router = useRouter();

  return (
    <div className="stamp">
      <LiveRefresh {...(topic ? { topic } : {})} busy={busy} typing={typing} />
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
