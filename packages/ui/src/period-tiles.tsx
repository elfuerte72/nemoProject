import { formatMinutes } from './format.js';
import { compareByCurrency, formatByCurrency, type MoneyLine } from './money-list.js';
import { Stat, trendTone } from './stat.js';

/**
 * Плитки сводки за период — одни на аналитику панели, карточку
 * мерчанта и обзор кабинета: подано, исполнено, отменено, в работе, до
 * исполнения. Подписи «было N» и тона — тем же правилом везде; три
 * набора одних и тех же плиток разошлись бы в словах при первой правке.
 *
 * Ссылка с плитки — по желанию и только там, где число становится
 * списком за тот же срок: у списка заявок кабинета периода нет, и
 * плитка «за 7 дней: 3», ведущая на список за всё время, врала бы.
 */

export interface PeriodCounts {
  readonly submitted: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly open: number;
  readonly averageMinutesToComplete: number | null;
}

export function ExchangeCountTiles({
  current,
  previous,
  openHref,
  open = true,
  duration = true,
}: {
  readonly current: PeriodCounts;
  readonly previous: PeriodCounts;
  /** Куда ведёт «В работе» — оно про сейчас, а не про период. */
  readonly openHref?: string | undefined;
  /**
   * Рисовать ли «В работе». Аналитика кабинета без неё: плитка про
   * «сейчас», а не про период, и то же число там стоит в воронке.
   */
  readonly open?: boolean;
  /**
   * Рисовать ли «До исполнения». Обзор кабинета без неё: срок — число
   * для разбора, а не для ежедневного взгляда, и живёт в аналитике.
   */
  readonly duration?: boolean;
}) {
  return (
    <>
      <Stat
        label="Подано"
        value={current.submitted}
        note={`заявок · было ${previous.submitted}`}
        tone={trendTone(current.submitted, previous.submitted)}
      />
      <Stat
        label="Исполнено"
        value={current.completed}
        note={`по дате исполнения · было ${previous.completed}`}
        tone={trendTone(current.completed, previous.completed)}
      />
      <Stat
        label="Отменено"
        value={current.cancelled}
        note={`по дате отмены · было ${previous.cancelled}`}
        // Рост отмен — плохо: тон не по общему правилу.
        tone={current.cancelled > previous.cancelled ? 'down' : 'plain'}
      />
      {open ? (
        <Stat
          label="В работе"
          value={current.open}
          note="из поданных в период"
          tone={current.open ? 'wait' : 'plain'}
          {...(openHref ? { href: openHref } : {})}
        />
      ) : undefined}
      {duration ? (
        <Stat
          label="До исполнения"
          value={formatMinutes(current.averageMinutesToComplete)}
          note={
            previous.averageMinutesToComplete === null
              ? 'в среднем от подачи до исполнения'
              : `в среднем · было ${formatMinutes(previous.averageMinutesToComplete)}`
          }
        />
      ) : undefined}
    </>
  );
}

export interface FailureCounts {
  readonly total: number;
  readonly failed: number;
}

/** «из них 2 с ошибкой», «все прошли» или «за период не было». */
function failureNote(counts: FailureCounts, what: string): string {
  if (counts.total === 0) return 'за период не было';
  return counts.failed === 0 ? 'все прошли' : `из них ${counts.failed} ${what}`;
}

/**
 * Плитки интеграции мерчанта: вызовы API и доставки вебхуков за
 * период. Красным — там, где были отказы: это то, ради чего на них
 * смотрят.
 */
export function IntegrationTiles({
  apiCalls,
  webhookDeliveries,
  callsHref,
  webhooksHref,
}: {
  readonly apiCalls: FailureCounts;
  readonly webhookDeliveries: FailureCounts;
  readonly callsHref?: string | undefined;
  readonly webhooksHref?: string | undefined;
}) {
  return (
    <>
      <Stat
        label="Вызовов API"
        value={apiCalls.total}
        note={failureNote(apiCalls, 'с ошибкой')}
        tone={apiCalls.failed > 0 ? 'down' : 'plain'}
        {...(callsHref ? { href: callsHref } : {})}
      />
      <Stat
        label="Доставок вебхуков"
        value={webhookDeliveries.total}
        note={failureNote(webhookDeliveries, 'не доставлено')}
        tone={webhookDeliveries.failed > 0 ? 'down' : 'plain'}
        {...(webhooksHref ? { href: webhooksHref } : {})}
      />
    </>
  );
}

/**
 * Деньги по валютам с прошлым периодом: «12 300 RUB · 450 USDT» и под
 * ним «RUB: было 10 200 RUB» со знаком. Валюты сравниваются только с
 * собой — рубли с рублями (docs/adr/0013).
 */
export function MoneyCompare({
  now,
  before,
}: {
  readonly now: readonly MoneyLine[];
  readonly before: readonly MoneyLine[];
}) {
  const compared = compareByCurrency(now, before);
  return (
    <>
      <p className="money">{formatByCurrency(now)}</p>
      {compared.length ? (
        <ul className="rows rows--tight">
          {compared.map((one) => (
            <li key={one.code} className={`delta delta--${one.delta}`}>
              {one.code}: было {formatByCurrency([{ code: one.code, amount: one.before }])}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">было {formatByCurrency(before)}</p>
      )}
    </>
  );
}
