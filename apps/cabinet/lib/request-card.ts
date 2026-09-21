import type { ExchangeRequestStatus } from '@nemo/types';

/**
 * Что карточка заявки говорит о реквизитах — по состоянию заявки.
 *
 * Реквизиты у заявки появляются при подтверждении курса и остаются с
 * ней до конца: у оплаченной, у исполненной, у отменённой. Блок же
 * «Куда платить» показывался всякий раз, когда они есть, — и 21
 * сентября 2026 исполненная заявка звала платить, называла срок и
 * обещала, что сервис её отменит.
 *
 * Правило живёт здесь, а не в разметке: ошибка в нём про деньги. Призыв
 * платить у отменённой заявки — это перевод, которого никто не ждёт, а
 * по реквизитам он всё равно уйдёт.
 */

export interface PaymentBlock {
  /** Зовём платить, показываем запись об оплате или отговариваем. */
  readonly kind: 'pay' | 'paid' | 'void';
  readonly title: string;
  readonly note: string;
  /** Называть ли срок оплаты: он значит что-то, только пока платят. */
  readonly deadline: boolean;
}

const BLOCKS: Record<PaymentBlock['kind'], PaymentBlock> = {
  pay: {
    kind: 'pay',
    title: 'Куда платить',
    note: 'Проверьте получателя перед переводом: деньги, ушедшие по опечатке, не возвращаются.',
    deadline: true,
  },
  paid: {
    kind: 'paid',
    title: 'Куда платили',
    note: 'Оплата по этой заявке получена, платить больше не нужно. Реквизиты оставлены для сверки.',
    deadline: false,
  },
  void: {
    kind: 'void',
    title: 'Реквизиты больше не действуют',
    note: 'Заявка отменена, не платите по ним. Если перевод уже ушёл, напишите в поддержку.',
    deadline: false,
  },
};

/**
 * Состояние — в вид блока. Записано таблицей по всем состояниям, а не
 * условием «если ждёт оплаты»: новое состояние заявки не соберётся,
 * пока здесь не решат, что при нём говорить о реквизитах.
 */
const BY_STATUS: Record<ExchangeRequestStatus, PaymentBlock['kind'] | null> = {
  // До подтверждения курса реквизитов ядро не пишет. Взявшиеся откуда-то
  // раньше срока платить не зовут: курс ещё не назван.
  new: null,
  in_progress: null,
  rate_confirmed: 'pay',
  payment_received: 'paid',
  completed: 'paid',
  cancelled: 'void',
};

export function paymentBlockOf(request: {
  readonly status: ExchangeRequestStatus;
  readonly paymentInstructions: string | null;
}): PaymentBlock | null {
  if (!request.paymentInstructions) return null;
  const kind = BY_STATUS[request.status];
  return kind === null ? null : BLOCKS[kind];
}
