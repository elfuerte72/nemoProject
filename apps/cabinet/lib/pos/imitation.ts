import type { Amount } from '@nemo/types';
import type { Acquirer, IssuedPayment, PaymentToIssue, QrView, RefundOutcome } from './acquirer';

/**
 * Имитация провайдера приёма: QR ненастоящий, «оплатить» его может
 * только кнопка на экране мерчанта.
 *
 * Заведена, чтобы экран, счёт и возврат прошли весь путь до того, как
 * появится банк: срок счёта, перевыпуск QR, оплата, истечение, возврат.
 * Банк встанет за тот же интерфейс, и экраны этого не заметят.
 *
 * Состояния у имитации нет: всё, что она «помнит», выводится из ссылки
 * на платёж и часов. Так она одинаково ведёт себя в каждом процессе и
 * в каждом тесте, и после перезапуска не теряет ничего, потому что
 * терять нечего.
 */

export const IMITATION = 'imitation';

/**
 * Сколько живёт один QR. Пять минут — столько у образца живёт QR банка
 * по СБП, и имитация держит тот же ритм, чтобы экран перевыпуска был
 * проверен до банка, а не вместе с ним.
 */
export const QR_TTL_MS = 5 * 60_000;

/** Номер пятиминутного окна: QR меняется на его границе. */
export function qrWindow(at: Date): number {
  return Math.floor(at.getTime() / QR_TTL_MS);
}

/**
 * QR имитации. Содержимое нарочно не похоже ни на ссылку банка, ни на
 * платёжную ссылку вообще: телефон, считавший его, покажет слово
 * «imitation», а не откроет банковское приложение.
 */
export function imitationQr(ref: string, at: Date): QrView {
  const window = qrWindow(at);
  const payload = `TOBEE-POS-IMITATION|${ref}|${window}`;
  return {
    payload,
    link: payload,
    issuedAt: new Date(window * QR_TTL_MS).toISOString(),
    expiresAt: new Date((window + 1) * QR_TTL_MS).toISOString(),
  };
}

/** Ссылка на платёж у имитации — по идентификатору счёта, чтобы её узнавали в ленте. */
export function imitationRef(invoiceId: string): string {
  return `imit_${invoiceId}`;
}

export class ImitationAcquirer implements Acquirer {
  readonly name = IMITATION;
  readonly title = 'Имитация';

  async issue(payment: PaymentToIssue): Promise<IssuedPayment> {
    return { ref: imitationRef(payment.invoiceId) };
  }

  async qr(ref: string, at: Date): Promise<QrView | null> {
    return imitationQr(ref, at);
  }

  async cancel(): Promise<void> {
    // Имитации нечего отменять: платежа у неё не было.
  }

  /**
   * Возврат исполняется сразу. У банка между заявкой и деньгами стоят
   * часы и решение, и состояние «Ожидает» существует ради них; у
   * имитации ждать некого, а рисовать ожидание, которое ничем не
   * кончится, значило бы обещать ответ.
   */
  async refund(ref: string, _amount: Amount, _code: string, at: Date): Promise<RefundOutcome> {
    return { state: 'done', ref: `${ref}_refund_${at.getTime().toString(36)}` };
  }
}
