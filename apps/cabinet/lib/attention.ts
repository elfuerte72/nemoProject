import type { WebhookEndpointState } from '@nemo/types';
import { plural } from './plural';

/**
 * Что требует внимания мерчанта прямо сейчас — одной строкой над
 * обзором.
 *
 * Правило, а не украшение: у мерчанта ломается не кабинет, а его
 * интеграция, и узнаёт он об этом от своих покупателей. У нас доставка
 * помечена неудачной ещё вчера — значит сказать должны мы.
 *
 * Тревога **одна**: список бед на главной это стена, по которой взгляд
 * скользит. Показывается самая срочная, остальные ждут в своём
 * разделе. И тревога **исчезает**, когда всё хорошо: постоянная плашка
 * «всё в порядке» информации не несёт, а глаз, привыкший её
 * пропускать, пропустит и красную.
 *
 * Состояние интеграции при этом остаётся на экране всегда — плиткой в
 * ряду показателей. Это разные вещи: плитка отвечает «как дела у
 * интеграции», строка — «брось всё и почини».
 *
 * Состояние точки берётся готовым (`WebhookEndpointState`), а не
 * выводится здесь заново из отметок: ядро уже решило, что `failing`
 * важнее `paused`, и второе правило об этом разошлось бы с первым.
 */

export interface AttentionFacts {
  /** Точки доставки мерчанта, как их отдаёт ядро. */
  readonly endpoints: readonly { readonly state: WebhookEndpointState }[];
  /** Доставки вебхуков за период. */
  readonly deliveries: { readonly total: number; readonly failed: number };
  /** Вызовы API за период. */
  readonly apiCalls: { readonly total: number; readonly failed: number };
}

export interface Attention {
  /** `alarm` — мерчант теряет деньги сейчас; `warn` — стоит взглянуть. */
  readonly tone: 'alarm' | 'warn';
  /** Одно слово слева, как отметка рода беды. */
  readonly label: string;
  readonly text: string;
  readonly href: string;
}

export function attentionOf(facts: AttentionFacts): Attention | null {
  const failing = facts.endpoints.filter((one) => one.state === 'failing').length;
  if (failing > 0) {
    const missed = facts.deliveries.failed;
    return {
      tone: 'alarm',
      label: 'Сбой',
      text: missed
        ? `Вебхуки не доходят: ${missed} ${plural(missed, 'доставка', 'доставки', 'доставок')} не ${plural(missed, 'прошла', 'прошли', 'прошли')}. Ваша система не узнаёт об оплатах.`
        : 'Вебхуки не доходят. Ваша система не узнаёт об оплатах.',
      href: '/webhooks',
    };
  }

  /*
   * Пауза — остановка целиком: новые события точке не пишутся вовсе.
   * Идёт после `failing` тем же порядком, каким их различает ядро.
   */
  const paused = facts.endpoints.filter((one) => one.state === 'paused').length;
  if (paused > 0) {
    return {
      tone: 'alarm',
      label: 'Остановлено',
      text:
        paused === 1
          ? 'Доставка на паузе: события копятся, и ваша система об оплатах не узнаёт.'
          : `Доставка на паузе у ${paused} ${plural(paused, 'точки', 'точек', 'точек')}: события копятся, и ваша система об оплатах не узнаёт.`,
      href: '/webhooks',
    };
  }

  /*
   * Отвергнутый вызов — обычно интегратор отлаживает свой код, а не
   * авария. Поэтому предупреждение и последняя очередь.
   */
  const failedCalls = facts.apiCalls.failed;
  if (failedCalls > 0) {
    return {
      tone: 'warn',
      label: 'Внимание',
      text: `Отвергнуто ${failedCalls} ${plural(failedCalls, 'вызов', 'вызова', 'вызовов')} API. Чаще всего дело в ключе или подписи запроса.`,
      href: '/calls',
    };
  }

  return null;
}
