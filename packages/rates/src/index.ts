import type { RateSource } from '@nemo/core';
import { createChainRateSource } from './chain.js';
import { createFiatRateSource } from './fiat.js';
import { createRapiraRateSource } from './rapira.js';

/**
 * Источники курса для приложения.
 *
 * Их два, и делят они справочник по природе валют: криптовалютную
 * сторону котирует биржа, фиатную — центральный банк (docs/adr/0007).
 * Наружу оба отдаются одним интерфейсом `RateSource` из `@nemo/core`:
 * заявка на обмен не знает, у кого спрошена цена, и знать не должна.
 */

export { createChainRateSource } from './chain.js';
export { createFiatRateSource, type FiatRatesOptions } from './fiat.js';
export { createRapiraRateSource, type RapiraOptions } from './rapira.js';
export { createSnapshotCache, type Snapshot, type SnapshotCache } from './snapshots.js';

/**
 * Источник курса для приложения. Ключ Rapira необязателен, у ЕЦБ его
 * нет вовсе, — поэтому отсутствие `RAPIRA_KEY` не мешает развернуться:
 * котировки просто пойдут анонимными запросами.
 *
 * Прогрев включён у обоих: единственное ожидание чужого сервера — это
 * первое обращение после запуска процесса, и прогрев съедает его до
 * прихода первого клиента.
 */
export function ratesFromEnvironment(): RateSource {
  return createChainRateSource([
    createRapiraRateSource({ apiKey: process.env.RAPIRA_KEY, warmUp: true }),
    createFiatRateSource({ warmUp: true }),
  ]);
}
