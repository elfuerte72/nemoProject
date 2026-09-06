import { cache } from 'react';
import { CoreError } from '@nemo/core';
import type { ExchangeRequestStatus } from '@nemo/types';
import { requireViewer, type MerchantViewer } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { OPEN_STATUSES } from '@/lib/request-rows';
import { SessionError } from '@/lib/session';

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

export const viewer = cache(async (): Promise<MerchantViewer> => requireViewer());

/**
 * То же для каркаса: `null` означает «нужно войти».
 *
 * Поверх той же памяти, а не рядом с ней: каркас спрашивает первым, а
 * раздел под ним — вторым, и два чтения сессии на страницу были бы
 * ровно тем, ради чего эта память и заведена.
 */
export async function viewerOrNull(): Promise<MerchantViewer | null> {
  try {
    return await viewer();
  } catch (error) {
    if (error instanceof SessionError) return null;
    if (error instanceof CoreError && error.code === 'forbidden') return null;
    throw error;
  }
}

/** Ник поддержки — общий на все экраны кабинета и на все письма. */
export const supportUsername = cache(
  async (): Promise<string | null> => getCore().merchantSupportUsername(),
);

/**
 * Сколько заявок в каждом состоянии. Одним запросом на все табы и на
 * счётчик в меню: состояний шесть, и шесть запросов «сколько там» —
 * это шесть заходов в базу за одно и то же число.
 */
export const requestCounts = cache(
  async (): Promise<Readonly<Record<ExchangeRequestStatus, number>>> => {
    const { actor } = await viewer();
    return getCore().countExchangeRequestsByStatus(actor);
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
