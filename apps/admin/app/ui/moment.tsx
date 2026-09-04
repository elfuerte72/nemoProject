'use client';

import { useEffect, useState } from 'react';
import { formatDay, formatMoment, formatTime } from '@/lib/format';

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
  /**
   * `day` — для случившегося однажды: час подачи в очереди только шумит.
   * `time` — под пузырём в ленте, где день назван разделителем.
   */
  mode = 'moment',
}: {
  readonly at: string;
  readonly mode?: 'moment' | 'day' | 'time';
}) {
  const format =
    mode === 'day'
      ? formatDay
      : mode === 'time'
        ? (value: Date, _now: Date, zone: string) => formatTime(value, zone)
        : formatMoment;
  const zone = useBrowserZone() ?? 'UTC';

  return (
    <time dateTime={at} suppressHydrationWarning>
      {format(new Date(at), new Date(), zone)}
    </time>
  );
}

/**
 * Пояс браузера — после появления разметки, до того — неизвестен.
 *
 * Один хук на всё, что печатает время: лента переписки считает по нему
 * разделители дней, `Moment` — сами отметки, и разойтись они не могут.
 */
export function useBrowserZone(): string | undefined {
  const [zone, setZone] = useState<string>();
  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  return zone;
}
