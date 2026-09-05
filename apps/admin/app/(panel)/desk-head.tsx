'use client';

import { useState, type ReactNode } from 'react';
import { LiveQueue } from '@/app/ui/live-queue';
import { QueueFilters } from './queue-filters';

/**
 * Верх рабочего стола: заголовок с отметкой времени, обзор, фильтры.
 *
 * Собраны вместе не по месту на экране, а по общему состоянию: пока в
 * поле поиска набирают, тихое обновление ждёт, — а знают об этом оба
 * только рядом. Заголовок и обзор приходят готовыми с сервера и
 * вставляются между ними: так фильтры стоят под плитками, а не над
 * ними, а состояние по-прежнему одно.
 */
export function DeskHead({
  fetchedAt,
  query,
  kind,
  status,
  heading,
  overview,
  tools,
}: {
  readonly fetchedAt: string;
  readonly query: string;
  readonly kind: string;
  readonly status: string;
  /** Приветствие и подзаголовок — левая часть шапки. */
  readonly heading: ReactNode;
  /** Плитки и быстрые переходы — между шапкой и фильтрами. */
  readonly overview: ReactNode;
  /** Кнопки рядом с отметкой времени: «Поля». */
  readonly tools?: ReactNode;
}) {
  const [typing, setTyping] = useState(false);

  return (
    <>
      <header className="page__head">
        {heading}
        <div className="page__actions">
          {tools}
          <LiveQueue fetchedAt={fetchedAt} topic="exchange" typing={typing} />
        </div>
      </header>
      {overview}
      <QueueFilters query={query} kind={kind} status={status} onTyping={setTyping} />
    </>
  );
}
