'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { SEARCH_MAX, tabHref } from '@/lib/request-rows';

/**
 * Поиск заявки по своему номеру: живёт в адресе, уходит с паузой в
 * треть секунды — тот же приём, что у поиска мерчантов и клиентов в
 * панели.
 *
 * Своё тут одно: набранный запрос переводит список на «Все». Ищущий
 * «заказ 1013» не знает, исполнена заявка или отменена, — за этим он и
 * пришёл, — и поиск внутри открытого таба «В работе» отвечал бы ему
 * «ничего нет» про заявку, которая есть. Табы при этом остаются: нашёл
 * двадцать — сузил до исполненных.
 */
export function RequestsSearch({
  query,
  period,
}: {
  readonly query: string;
  /** Период параметрами адреса: набранный номер не должен сбрасывать даты. */
  readonly period: Readonly<Record<string, string>>;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState(query);
  const pushed = useRef(query);

  // Запрос сменился не отсюда — кнопкой «назад» или ссылкой: поле
  // обязано показать то, что на самом деле ищется.
  useEffect(() => {
    if (query !== pushed.current) {
      pushed.current = query;
      setTyped(query);
    }
  }, [query]);

  useEffect(() => {
    if (typed.trim() === query) return;
    const timer = setTimeout(() => {
      const asked = typed.trim();
      pushed.current = asked;
      router.replace(tabHref(asked ? 'all' : 'open', asked, period), { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
  }, [typed, query, period, router]);

  return (
    <label className="filters__field">
      <span className="cell__label">Найти заявку</span>
      <input
        className="input"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder="Ваш номер: заказ, бронь, счёт"
        type="search"
        inputMode="search"
        autoComplete="off"
        maxLength={SEARCH_MAX}
      />
    </label>
  );
}
