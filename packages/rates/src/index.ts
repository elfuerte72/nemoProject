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
 * котирует биржа, фиатную — центральный банк (docs/adr/0007), а бат и
 * юань — площадки, на которых они торгуются на самом деле: тайская
 * биржа и красный стакан HTX. У банка эти двое тоже есть, но опорным
 * курсом, по которому не купить. Наружу все отдаются одним интерфейсом `RateSource` из
 * `@nemo/core`: заявка на обмен не знает, у кого спрошена цена, и знать
 * не должна.
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
 * Bitkub и HTX стоят раньше ЕЦБ намеренно: бат и юань есть у всех, но у
 * банка они опорные и суточные, а сервис покупает валюту на рынке. ЕЦБ
 * при этом остаётся за ними обоими — не запасным путём, а тем же
 * правилом цепочки: пару отдаёт первый, кто её знает, и молчащая
 * площадка не оставляет клиента без курса.
 */
export function ratesFromEnvironment(): RateSource {
  return composeRateSources([
    createRapiraRateSource({ apiKey: process.env.RAPIRA_KEY, warmUp: true }),
    createBitkubRateSource({ warmUp: true }),
    createHtxRateSource({ warmUp: true }),
    createFiatRateSource({ warmUp: true }),
  ]);
}
