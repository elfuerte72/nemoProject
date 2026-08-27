import type { RateSource } from '@nemo/core';
import { createBitkubRateSource } from './bitkub.js';
import { createChainRateSource } from './chain.js';
import { createCrossRateSource, type CrossRateOptions } from './cross.js';
import { createFiatRateSource } from './fiat.js';
import { createHtxRateSource } from './htx.js';
import { createRapiraRateSource } from './rapira.js';

/**
 * Источники курса для приложения.
 *
 * Делят они справочник по природе валют: криптовалютную сторону
 * котирует биржа, фиатную — центральный банк (docs/adr/0007). Валюту,
 * которую сервис где-то покупает по-настоящему, у банка при этом не
 * спрашивают: бат идёт от тайской биржи, юань, евро и доллар — из
 * красного стакана HTX, где сервис и продаёт за них USDT
 * (docs/adr/0011). У банка все четыре тоже есть, но опорным курсом, по
 * которому не купить, а доллар и вовсе приравнен к монете. Наружу все
 * отдаются одним интерфейсом `RateSource` из `@nemo/core`: заявка на
 * обмен не знает, у кого спрошена цена, и знать не должна.
 */

export { createBitkubRateSource, type BitkubOptions } from './bitkub.js';
export { createChainRateSource } from './chain.js';
export { createCrossRateSource, type CrossRateOptions } from './cross.js';
export { createFiatRateSource, type FiatRatesOptions } from './fiat.js';
export { createHtxRateSource, type HtxOptions } from './htx.js';
export { createRapiraRateSource, type RapiraOptions } from './rapira.js';
export { createSnapshotCache, type Snapshot, type SnapshotCache } from './snapshots.js';

/**
 * Провайдеры как один источник: сначала все прямые по порядку, а следом
 * составной — поверх тех же прямых.
 *
 * Порядок значим и потому собран здесь, а не расписан по вызовам.
 * Прямая котировка всегда лучше собранной: собранная это цена, которой
 * никто на рынке не называл, и браться за неё можно только когда прямой
 * нет ни у кого. Составной при этом ходит в те же прямые источники —
 * поэтому получает их цепочку, а не сам себя.
 */
export function composeRateSources(
  direct: readonly RateSource[],
  options?: CrossRateOptions,
): RateSource {
  const chain = createChainRateSource(direct);
  return createChainRateSource([chain, createCrossRateSource(chain, options)]);
}

/**
 * Источник курса для приложения. Ключ Rapira необязателен, у остальных
 * его нет вовсе, — поэтому отсутствие `RAPIRA_KEY` не мешает
 * развернуться: котировки просто пойдут анонимными запросами.
 *
 * Прогрев включён у всех: единственное ожидание чужого сервера — это
 * первое обращение после запуска процесса, и прогрев съедает его до
 * прихода первого клиента.
 *
 * Биржа и стакан стоят раньше ЕЦБ намеренно: бат, юань, доллар и евро
 * есть и у банка, но там они опорные и суточные, а сервис покупает
 * валюту на рынке. Доллар у банка и вовсе стоит единицей — USDT
 * приравнен к нему таблицей. ЕЦБ при этом остаётся за всеми ними — не
 * запасным путём, а тем же правилом цепочки: пару отдаёт первый, кто её
 * знает, и молчащая площадка не оставляет клиента без курса.
 */
export function ratesFromEnvironment(): RateSource {
  return composeRateSources([
    createRapiraRateSource({ apiKey: process.env.RAPIRA_KEY, warmUp: true }),
    createBitkubRateSource({ warmUp: true }),
    createHtxRateSource({ warmUp: true }),
    createFiatRateSource({ warmUp: true }),
  ]);
}
