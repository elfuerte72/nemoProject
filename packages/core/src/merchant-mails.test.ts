import { describe, expect, it } from 'vitest';
import { Money } from '@nemo/types';
import { slopComplaints } from './bot-slop';
import {
  MERCHANT_LINK_PLACEHOLDER,
  merchantMailSignature,
  renderMerchantMail,
  type MerchantMail,
} from './merchant-mails';
import { toClient, toMerchant, type Notification } from './notifications';

const MERCHANT = toMerchant({ id: 'm1', email: 'shop@example.com' });

/**
 * Письма мерчанту. Проверяются снимком текста: письмо уходит наружу и
 * читается человеком, который решает по нему, что делать с деньгами, —
 * правка формулировки должна быть видна на ревью, а не обнаруживаться
 * в почтовом ящике.
 */

describe('письма об аккаунте', () => {
  it('подтверждение почты зовёт по ссылке и называет её срок', () => {
    const mail = mailFor({ kind: 'merchant-email-verification', to: MERCHANT, token: 'abc' });
    expect(mail.subject).toBe('Подтвердите почту');
    expect(mail.text).toContain(MERCHANT_LINK_PLACEHOLDER);
    expect(mail.text).toContain('сутки');
  });

  it('сброс пароля говорит, что делать тому, кто его не просил', () => {
    const mail = mailFor({ kind: 'merchant-password-reset', to: MERCHANT, token: 'abc' });
    expect(mail.subject).toBe('Смена пароля');
    expect(mail.text).toContain('старый');
  });

  it('отказ по анкете называет причину: без неё письмо ничего не сообщает', () => {
    const mail = mailFor({
      kind: 'merchant-application-decided',
      to: MERCHANT,
      rejectionReason: 'не отвечает на письма',
    });
    expect(mail.subject).toBe('Анкета отклонена');
    expect(mail.text).toContain('не отвечает на письма');
  });
});

describe('письма о заявке', () => {
  const base = {
    kind: 'exchange-request-status',
    to: MERCHANT,
    requestId: 'r1',
  } as const;

  /**
   * Главное правило этих писем: реквизиты остаются в кабинете. Почтовый
   * ящик сервису не принадлежит, а перевод по подменённым реквизитам не
   * возвращается.
   */
  it('о подтверждённом курсе зовёт в кабинет и не везёт реквизиты', () => {
    const mail = mailFor({
      ...base,
      status: 'rate_confirmed',
      finalRate: Money.toAmount('81.5'),
      paymentInstructions: 'Карта 4276 1234 5678 9010, Пётр П.',
      payWithinMinutes: 60,
    });
    expect(mail.subject).toBe('Курс подтверждён, заявка ждёт оплаты');
    expect(mail.text).toContain('81.5');
    expect(mail.text).toContain('кабинете');
    expect(mail.text).not.toContain('4276');
    expect(mail.text).toContain('60 мин');
  });

  it('об отмене называет причину', () => {
    const mail = mailFor({ ...base, status: 'cancelled', cancelReason: 'нет оплаты' });
    expect(mail.subject).toBe('Заявка отменена');
    expect(mail.text).toContain('нет оплаты');
  });

  /*
   * Заявку он подал сам и ответ видел, а «менеджер взял в работу» —
   * событие для вебхука: письмо на каждый шаг превращается в шум, и
   * тогда не читается то письмо, где ждут оплаты.
   */
  it('о принятой и взятой в работу письма нет', () => {
    expect(renderMerchantMail({ ...base, status: 'new' })).toBeNull();
    expect(renderMerchantMail({ ...base, status: 'in_progress' })).toBeNull();
  });

  it('срок оплаты на исходе — письмо с остатком времени', () => {
    const mail = mailFor({
      kind: 'exchange-request-expiring',
      to: MERCHANT,
      requestId: 'r1',
      minutesLeft: 30,
    });
    expect(mail.text).toContain('30 мин');
  });
});

/**
 * Клиентское уведомление письмом не уходит: у клиента нет почты, и его
 * заявку доставляет бот. Доставщик берёт свои и молча пропускает чужие.
 */
describe('чужие уведомления', () => {
  it('заявка клиента письмом не превращается', () => {
    expect(
      renderMerchantMail({
        kind: 'exchange-request-status',
        to: toClient(42n),
        requestId: 'r1',
        status: 'completed',
      }),
    ).toBeNull();
  });

  it('сообщение сотруднику — не письмо', () => {
    expect(
      renderMerchantMail({ kind: 'client-message-received', to: 42n }),
    ).toBeNull();
  });
});

describe('подпись письма', () => {
  it('ведёт в кабинет и в поддержку', () => {
    expect(
      merchantMailSignature({
        cabinetUrl: 'https://business.tobee.ru/',
        supportUsername: '@tobee_help',
      }),
    ).toBe('Кабинет: https://business.tobee.ru\nПоддержка: https://t.me/tobee_help');
  });

  it('без ника поддержки — только кабинет: ссылка в пустой чат хуже её отсутствия', () => {
    expect(merchantMailSignature({ cabinetUrl: 'https://business.tobee.ru' })).toBe(
      'Кабинет: https://business.tobee.ru',
    );
  });
});

/**
 * Тем же правилом, что тексты бота: машинный ритм в письме читается как
 * автоответчик, а письма правятся раз в полгода — к этому сроку
 * замечание с прошлого ревью помнит только тот, кто его делал.
 */
describe('письма набраны человеком', () => {
  const letters: readonly Notification[] = [
    { kind: 'merchant-email-verification', to: MERCHANT, token: 'abc' },
    { kind: 'merchant-password-reset', to: MERCHANT, token: 'abc' },
    { kind: 'merchant-application-decided', to: MERCHANT },
    { kind: 'merchant-application-decided', to: MERCHANT, rejectionReason: 'нет сайта' },
    {
      kind: 'exchange-request-status',
      to: MERCHANT,
      requestId: 'r1',
      status: 'rate_confirmed',
      finalRate: Money.toAmount('81.5'),
      payWithinMinutes: 60,
    },
    { kind: 'exchange-request-status', to: MERCHANT, requestId: 'r1', status: 'payment_received' },
    { kind: 'exchange-request-status', to: MERCHANT, requestId: 'r1', status: 'completed' },
    { kind: 'exchange-request-status', to: MERCHANT, requestId: 'r1', status: 'cancelled' },
    { kind: 'exchange-request-expiring', to: MERCHANT, requestId: 'r1', minutesLeft: 30 },
  ];

  it.each(letters.map((one) => [`${one.kind}`, one] as const))('%s', (_name, notification) => {
    const mail = mailFor(notification);
    expect(slopComplaints(`${mail.subject}\n${mail.text}`)).toEqual([]);
  });
});

function mailFor(notification: Notification): MerchantMail {
  const mail = renderMerchantMail(notification);
  if (!mail) throw new Error(`нет письма по ${notification.kind}`);
  return mail;
}
