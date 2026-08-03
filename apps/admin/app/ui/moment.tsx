'use client';

import { useEffect, useState } from 'react';
import { formatDay, formatMoment } from '@/lib/format';

/**
 * Время события — в часах того, кто на него смотрит.
 *
 * Страницы панели рисуются на сервере, а сервер живёт в UTC: без этого
 * компонента менеджер видел бы время, которого на его часах не было, и
 * «сегодня» у него начиналось бы посреди дня.
 *
 * Поэтому первый вид — серверный, по UTC, а пояс браузера подставляется
 * после появления разметки: до этого момента его знает только браузер.
 * Расхождение двух видов на границе суток разрешает
 * `suppressHydrationWarning` — оно здесь ожидаемо, а не признак ошибки.
 */
export function Moment({
  at,
  /** `day` — для случившегося однажды: час подачи в очереди только шумит. */
  mode = 'moment',
}: {
  readonly at: string;
  readonly mode?: 'moment' | 'day';
}) {
  const format = mode === 'day' ? formatDay : formatMoment;
  const [zone, setZone] = useState('UTC');

  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  return (
    <time dateTime={at} suppressHydrationWarning>
      {format(new Date(at), new Date(), zone)}
    </time>
  );
}
