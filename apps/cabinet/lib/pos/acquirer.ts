import type { Amount } from '@nemo/types';
import { ImitationAcquirer, IMITATION } from './imitation';

/**
 * Провайдер приёма — шов между POS-терминалом и тем, кто примет деньги
 * покупателя.
 *
 * Денег у сервиса по-прежнему нет (`backlog.md`, решение от 10 сентября
 * 2026): приём по СБП ждёт банка, а вести баланс мерчанта сервису
 * нельзя по закону о платёжной системе. Экран, счёт и возврат при этом
 * уже нарисованы, и всё, что они спрашивают у денег, собрано здесь в
 * один интерфейс: заявить платёж, показать действующий QR, отменить,
 * вернуть. Банк встанет за этот интерфейс, не трогая экранов; до него
 * здесь стоит имитация (`imitation.ts`), и на экране это сказано
 * словами.
 *
 * Чего в интерфейсе нет намеренно: «спросить, оплачен ли». Об оплате
 * провайдер сообщает сам, и сообщение приходит в одну точку —
 * `acceptPayment` в `payments.ts`, одну для имитации и для банка. Опрос
 * состояния по кругу — второй путь к тому же факту, и два пути
 * разошлись бы на первом же обрыве связи.
 */

/** Что провайдеру говорят о платеже, когда счёт создан. */
export interface PaymentToIssue {
  readonly merchantId: string;
  readonly invoiceId: string;
  /** Короткий номер счёта: провайдер показывает его покупателю. */
  readonly number: string;
  /** Сколько и в чём платит покупатель. */
  readonly amount: Amount;
  readonly code: string;
  /** Покупатель подтверждает личность до оплаты. */
  readonly kycRequired: boolean;
  readonly at: Date;
  /** Когда счёт перестаёт приниматься к оплате. */
  readonly expiresAt: Date;
}

/** Ссылка на платёж у провайдера: по ней потом просят QR, отмену и возврат. */
export interface IssuedPayment {
  readonly ref: string;
}

/**
 * Действующий QR. Банковский QR живёт минуты, и перевыпускает его
 * провайдер, а не мы: покупатель у стойки всегда видит свежий код,
 * ничего для этого не нажимая.
 */
export interface QrView {
  readonly payload: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export type RefundOutcome =
  | { readonly state: 'done' | 'pending'; readonly ref: string }
  | { readonly state: 'rejected'; readonly reason: string };

export interface Acquirer {
  /** Машинное имя: по нему счёт помнит, кто принимал платёж. */
  readonly name: string;
  /** Как провайдер называется на экране. */
  readonly title: string;
  issue(payment: PaymentToIssue): Promise<IssuedPayment>;
  /** Пусто, когда QR у этого платежа больше не бывает — оплачен или истёк. */
  qr(ref: string, at: Date): Promise<QrView | null>;
  cancel(ref: string, at: Date): Promise<void>;
  refund(ref: string, amount: Amount, code: string, at: Date): Promise<RefundOutcome>;
}

const imitation = new ImitationAcquirer();

/**
 * Кто принимает платежи в этом процессе. Выбирается переменной
 * окружения `POS_ACQUIRER`; известна пока одна имитация, и незаданная
 * переменная означает её. Незнакомое имя — отказ при первом же счёте, а
 * не молчаливая имитация: банк, подключённый с опечаткой в имени, тихо
 * принимал бы «оплату» кнопкой.
 */
export function acquirer(env: Readonly<Record<string, string | undefined>> = process.env): Acquirer {
  const wanted = env.POS_ACQUIRER?.trim() || IMITATION;
  if (wanted === IMITATION) return imitation;
  throw new Error(`Провайдер приёма «${wanted}» не подключён: пока известна только имитация`);
}

export { IMITATION, QR_TTL_MS } from './imitation';
