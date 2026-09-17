import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { AnalyticsPeriod, BonusAccountView, ReferralCabinetStats } from '@nemo/core';
import { ambassadorOrNull, requireAmbassador, type AmbassadorViewer } from '@/lib/ambassador';
import { getCore } from '@/lib/core';
import { DOORS_PATH } from '@/lib/entry';
import { viewerOrElse } from '@/lib/session';

/**
 * Чтения кабинета амбассадора, которые на одной странице спрашивают
 * дважды: каркас и раздел под ним рисуются параллельно, и каждому нужно
 * знать, кто вошёл. Память живёт до конца запроса и ни секундой
 * дольше — тем же способом читает своё кабинет мерчанта
 * (`lib/reads.ts`).
 *
 * Каркас читает сессию через `ambassadorViewer` и сам решает, что
 * показать без отметки; разделы под ним — через `ambassadorPage`,
 * которая уводит на витрину: без сессии показывать им нечего.
 */

export const ambassadorViewer = cache(
  async (): Promise<AmbassadorViewer> => requireAmbassador(),
);

/**
 * Кто смотрит раздел. Без сессии — на витрину, и одинаково из любого
 * раздела: редирект одного компонента не отменяет чтения другого, и
 * отказ, брошенный наружу, лёг бы в журнал ошибкой (см. `viewerOrElse`).
 */
export const ambassadorPage = cache(
  async (): Promise<AmbassadorViewer> => viewerOrElse(ambassadorViewer, () => redirect(DOORS_PATH)),
);

/** Сводка за период — один пакет запросов на страницу, как у мерчанта. */
export const ambassadorStats = cache(
  async (from: number, to: number, offsetMinutes: number): Promise<ReferralCabinetStats> => {
    const { actor } = await ambassadorPage();
    const period: AnalyticsPeriod = { from: new Date(from), to: new Date(to) };
    return getCore().summarizeReferralCabinet(actor, period, { offsetMinutes });
  },
);

/**
 * Счёт баллов: заработанное за всё время, остаток и линии со ставками.
 * Спрашивают его обзор и раздел вывода, и оба на одной странице не
 * встречаются, — но ходит он в базу за пятью вещами разом, и лишний
 * заход стоит дороже памяти.
 */
export const ambassadorAccount = cache(async (): Promise<BonusAccountView> => {
  const { actor } = await ambassadorPage();
  return getCore().getBonusAccount(actor);
});

/** Есть ли живая сессия амбассадора — витрине, чтобы увести вошедшего. */
export { ambassadorOrNull };
