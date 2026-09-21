import { WEBHOOK_MAX_ATTEMPTS } from '@nemo/core';
import {
  webhookEventForStatus,
  type ExchangeRequestStatus,
  type WebhookDeliveryStatus,
  type WebhookEvent,
} from '@nemo/types';

/**
 * Хронология заявки вместе с вебхуками.
 *
 * Смена состояния — половина истории; вторая — узнала ли о ней система
 * мерчанта. Карточку заявки чаще всего открывают именно с этим: «у нас
 * заказ висит неоплаченным, а вы говорите, исполнено». Ответ лежал в
 * разделе «Вебхуки», в общем списке доставок, и искать в нём одну
 * заявку приходилось глазами.
 *
 * Файл серверный: число попыток он берёт у ядра, как `webhook-guide.ts`,
 * а ядро в браузер не собирается. Клиентскому компоненту отсюда брать
 * нечего — лента рисуется на сервере.
 */

export interface TrailEventInput {
  /** Откуда переход. У подачи пусто; равно `toStatus` у передачи заявки. */
  readonly fromStatus: ExchangeRequestStatus | null;
  readonly toStatus: ExchangeRequestStatus;
  readonly createdAt: Date;
  readonly comment: string | null;
}

export interface TrailDeliveryInput {
  readonly id: string;
  /** Точка, куда шла доставка: по ней лента ведёт в её историю. */
  readonly endpointId: string;
  readonly event: WebhookEvent;
  readonly status: WebhookDeliveryStatus;
  readonly attempt: number;
  readonly responseStatus: number | null;
  readonly nextAttemptAt: Date;
  readonly endpointUrl: string;
  /** Что записано о последней неудаче. Пусто, пока неудач не было. */
  readonly error: string | null;
  readonly createdAt: Date;
}

export interface TrailRow {
  readonly status: ExchangeRequestStatus;
  readonly at: Date;
  readonly comment: string | null;
  readonly deliveries: readonly TrailDeliveryInput[];
}

/**
 * Доставки — под свои смены состояния.
 *
 * Сопоставляет то же правило, по которому ядро ставит доставку в
 * очередь (`webhookEventForStatus`): своё правило здесь показало бы
 * доставку «исполнена» под «курс подтверждён» — и выглядело бы
 * правдоподобно. Пробная доставка к заявке не относится и сюда не
 * попадает, даже если её зачем-то передали.
 */
export function trailOf(
  events: readonly TrailEventInput[],
  deliveries: readonly TrailDeliveryInput[],
): TrailRow[] {
  const byTime = [...deliveries].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  /*
   * Передача заявки другому менеджеру пишет в историю событие без смены
   * состояния: «откуда» и «куда» равны. Мерчанту она не меняет ничего —
   * кто ведёт заявку, дело сервиса, — а в ленте вставала второй строкой
   * «Курс подтверждён», и под обеими оказывался один и тот же вебхук:
   * читалось как «прислали дважды». Найдено ревью 21 сентября 2026.
   */
  const moves = events.filter((event) => event.fromStatus !== event.toStatus);
  return moves.map((event) => {
    const expected = webhookEventForStatus(event.toStatus);
    return {
      status: event.toStatus,
      at: event.createdAt,
      comment: event.comment,
      deliveries: expected === undefined ? [] : byTime.filter((one) => one.event === expected),
    };
  });
}

const ATTEMPT_WORDS: Record<number, string> = { 5: 'пяти' };

/**
 * Исход доставки словами и тоном. Тон — три: дошло, ждёт (в том числе
 * повтора — это ждёт человека, медовым), провал.
 */
export function deliveryWords(delivery: TrailDeliveryInput): {
  readonly text: string;
  readonly tone: 'ok' | 'wait' | 'bad';
} {
  const answer =
    delivery.responseStatus === null ? 'приёмник не ответил' : `ответ ${delivery.responseStatus}`;

  if (delivery.status === 'delivered') {
    return {
      text: delivery.responseStatus === null ? 'доставлен' : `доставлен, ${delivery.responseStatus}`,
      tone: 'ok',
    };
  }
  if (delivery.status === 'failed') {
    /*
     * Провал раньше последней попытки бывает одним путём: точку удалили,
     * и её ждущие доставки закрыты разом, при любом числе попыток. Число
     * берётся у доставки, а не у константы: «после пяти попыток» стояло
     * у доставки, которую ни разу не отправляли.
     */
    if (delivery.attempt < WEBHOOK_MAX_ATTEMPTS) {
      return {
        text:
          delivery.attempt === 0
            ? 'не отправлен: точку удалили'
            : `не доставлен: точку удалили после попытки ${delivery.attempt}, ${answer}`,
        tone: 'bad',
      };
    }
    const attempts = ATTEMPT_WORDS[WEBHOOK_MAX_ATTEMPTS] ?? String(WEBHOOK_MAX_ATTEMPTS);
    return { text: `не доставлен после ${attempts} попыток, ${answer}`, tone: 'bad' };
  }
  if (delivery.attempt === 0) return { text: 'ждёт отправки', tone: 'wait' };
  /*
   * Номер попытки растёт, когда воркер доставку забирает, — до ответа
   * приёмника. Пока о неудаче ничего не записано, первая попытка ещё
   * идёт, и «не доставлен» о ней — неправда. У второй и дальше так не
   * различить: запись о прошлой неудаче остаётся до нового исхода.
   */
  if (delivery.responseStatus === null && delivery.error === null) {
    return { text: 'отправляется', tone: 'wait' };
  }
  return {
    text: `не доставлен, попытка ${delivery.attempt} из ${WEBHOOK_MAX_ATTEMPTS}, ${answer} — будет повтор`,
    tone: 'wait',
  };
}
