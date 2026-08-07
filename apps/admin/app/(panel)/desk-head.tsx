'use client';

import { useState } from 'react';
import { LiveQueue } from '@/app/ui/live-queue';
import { QueueFilters } from './queue-filters';

/**
 * Шапка рабочего стола: отметка времени, обновление и фильтры.
 *
 * Собраны вместе не по месту на экране, а по общему состоянию: пока в
 * поле поиска набирают, тихое обновление ждёт, — а знают об этом оба
 * только рядом.
 */
export function DeskHead({
  fetchedAt,
  query,
  kind,
  status,
}: {
  readonly fetchedAt: string;
  readonly query: string;
  readonly kind: string;
  readonly status: string;
}) {
  const [typing, setTyping] = useState(false);

  return (
    <>
      <LiveQueue fetchedAt={fetchedAt} typing={typing} />
      <QueueFilters query={query} kind={kind} status={status} onTyping={setTyping} />
    </>
  );
}
