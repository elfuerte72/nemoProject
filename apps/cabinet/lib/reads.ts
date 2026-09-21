import { cache } from 'react';
import { redirect } from 'next/navigation';
import type {
  AnalyticsPeriod,
  MerchantBreakdowns,
  MerchantStats,
  SeriesStep,
} from '@nemo/core';
import type { ExchangeRequestStatus } from '@nemo/types';
import { requireViewer, type MerchantViewer } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { OPEN_STATUSES } from '@/lib/request-rows';
import { viewerOrElse } from '@/lib/session';

/**
 * Чтения, которые на одной странице спрашивают дважды.
 *
 * Каркас кабинета и сам раздел под ним — два серверных компонента, и
 * каждому нужно одно и то же: кто вошёл и сколько у него незакрытых
 * заявок. Без памяти на запрос это два похода в базу за сессией и два
 * за счётчиками — на каждое тихое обновление, то есть каждые полминуты
 * у каждой открытой вкладки. `cache` из React помнит их до конца
 * запроса и ни секундой дольше: между запросами данные меняются.
 *
 * Тем же способом считает счётчики меню панель менеджера
 * (`apps/admin/lib/counts.ts`).
 */

/**
 * Без сессии — на вход, и из каркаса, и из раздела под ним одинаково:
 * они рисуются параллельно, и редирект одного не отменяет чтения
 * другого (см. `viewerOrElse`). Разделы под `(cabinet)` читают сессию
 * только отсюда — прямой `requireViewer` на странице вернул бы ошибку в
 * журнал; правило закреплено тестом в `session.test.ts`.
 */
export const viewer = cache(
  async (): Promise<MerchantViewer> => viewerOrElse(requireViewer, () => redirect('/login')),
);

/** Ник поддержки — общий на все экраны кабинета и на все письма. */
export const supportUsername = cache(
  async (): Promise<string | null> => getCore().merchantSupportUsername(),
);

/**
 * Сколько заявок в каждом состоянии. Одним запросом на все табы и на
 * счётчик в меню: состояний шесть, и шесть запросов «сколько там» —
 * это шесть заходов в базу за одно и то же число.
 */
const countsFor = cache(
  async (search: string): Promise<Readonly<Record<ExchangeRequestStatus, number>>> => {
    const { actor } = await viewer();
    return getCore().countExchangeRequestsByStatus(actor, search ? { search } : {});
  },
);

/**
 * Поиск — ключом памяти: меню спрашивает без него, список заявок с ним,
 * и на одной странице это два разных числа. Строкой, а не объектом:
 * `cache` сравнивает аргументы по ссылке.
 *
 * Обёрткой, а не самим `cache`: тот различает вызов без аргумента и
 * вызов с пустой строкой — ключ он строит и по числу аргументов. Меню
 * звало `requestCounts()`, список — `requestCounts('')`, и на самой
 * частой странице счёт шёл в базу дважды за показ, при каждом тихом
 * обновлении. Найдено ревью 21 сентября 2026 и подтверждено счётчиком
 * вызовов. Здесь аргумент у памяти всегда один.
 */
export function requestCounts(
  search = '',
): Promise<Readonly<Record<ExchangeRequestStatus, number>>> {
  return countsFor(search);
}

/**
 * Сводка за период — один пакет запросов на страницу. Ключ памяти —
 * границы периода и смещение: `cache` сравнивает аргументы по ссылке,
 * и датами в объекте он бы не сошёлся.
 */
export const merchantStats = cache(
  async (
    from: number,
    to: number,
    offsetMinutes: number,
    step: SeriesStep = 'day',
  ): Promise<MerchantStats> => {
    const { actor } = await viewer();
    const period: AnalyticsPeriod = { from: new Date(from), to: new Date(to) };
    return getCore().summarizeMerchant(actor, actor.merchantId, period, { offsetMinutes, step });
  },
);

/**
 * Разрезы за период — вторым пакетом запросов к тем же заявкам. Ключ
 * памяти тот же, что у сводки, плюс шаг сетки: `cache` сравнивает
 * аргументы по ссылке, и датами в объекте он бы не сошёлся.
 */
export const merchantBreakdowns = cache(
  async (
    from: number,
    to: number,
    offsetMinutes: number,
    step: SeriesStep,
  ): Promise<MerchantBreakdowns> => {
    const { actor } = await viewer();
    const period: AnalyticsPeriod = { from: new Date(from), to: new Date(to) };
    return getCore().breakdownMerchant(actor, actor.merchantId, period, {
      offsetMinutes,
      step,
    });
  },
);

/** Незакрытые заявки — то, чего мерчант ждёт и ради чего открывает кабинет. */
export function openCount(counts: Readonly<Record<ExchangeRequestStatus, number>>): number {
  return OPEN_STATUSES.reduce((total, status) => total + counts[status], 0);
}

export function countOf(
  counts: Readonly<Record<ExchangeRequestStatus, number>>,
  statuses: readonly ExchangeRequestStatus[] | undefined,
): number {
  const wanted = statuses ?? (Object.keys(counts) as ExchangeRequestStatus[]);
  return wanted.reduce((total, status) => total + counts[status], 0);
}
