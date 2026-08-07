import { describe, expect, it } from 'vitest';
import { slopComplaints } from './bot-slop';
import { BOT_DESCRIPTION, BOT_SHORT_DESCRIPTION, BOT_TEXTS } from './bot-texts';
import { renderNotification, type Notification } from './notifications';
import { Money } from '@nemo/types';

describe('slopComplaints', () => {
  it('пропускает тире там, где оно одно на предложение', () => {
    expect(slopComplaints('Курс виден сразу — по нему и обменяем.')).toEqual([]);
  });

  it('ловит связку, повторённую в одном предложении', () => {
    const complaints = slopComplaints(
      'Курс — цифрой здесь, ссылка — чтобы позвать знакомых, поддержка — если непонятно.',
    );
    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain('3 длинных тире');
  });

  /*
   * Второй связки уже хватает: строй фразы не менялся. Пороги у
   * предложения и столбца разные, и этот — нижний из двух.
   */
  it('ловит связку со второго раза, а не с третьего', () => {
    const complaints = slopComplaints('Курс — цифрой здесь, ссылка — чтобы позвать.');
    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain('2 длинных тире');
  });

  it('считает тире по предложениям, а не по абзацу', () => {
    expect(
      slopComplaints('Заявку возьмёт менеджер — он напишет. Курс держится час — успеете.'),
    ).toEqual([]);
  });

  it('ловит столбец одинаковых связок', () => {
    const complaints = slopComplaints('CNY — 7,05\nEUR — 0,84\nTHB — 32,44');
    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain('3 строки подряд');
  });

  it('оставляет пару строк: так набирают покупку и продажу', () => {
    expect(slopComplaints('Продаёте — 81 ₽\nПокупаете — 83 ₽')).toEqual([]);
  });

  it('ловит двойной дефис', () => {
    expect(slopComplaints('Курс -- по нему и обменяем.')).toHaveLength(1);
  });
});

/** Уведомление каждого вида: клиент видит их все, и каждое — текст бота. */
const EVERY_NOTIFICATION: readonly Notification[] = [
  { kind: 'referral-joined', to: 1n, line: 1 },
  { kind: 'referral-joined', to: 1n, line: 2 },
  { kind: 'exchange-request-status', to: 1n, requestId: 'r', status: 'new' },
  { kind: 'exchange-request-status', to: 1n, requestId: 'r', status: 'in_progress' },
  {
    kind: 'exchange-request-status',
    to: 1n,
    requestId: 'r',
    status: 'rate_confirmed',
    finalRate: Money.toAmount('81'),
    paymentInstructions: 'Карта 2200 0000 0000 0000, Иван И.',
    payWithinMinutes: 30,
  },
  { kind: 'exchange-request-status', to: 1n, requestId: 'r', status: 'payment_received' },
  { kind: 'exchange-request-status', to: 1n, requestId: 'r', status: 'completed' },
  { kind: 'exchange-request-status', to: 1n, requestId: 'r', status: 'cancelled' },
  {
    kind: 'exchange-request-status',
    to: 1n,
    requestId: 'r',
    status: 'cancelled',
    cancelReason: 'оплата не пришла',
  },
  { kind: 'exchange-request-expiring', to: 1n, requestId: 'r', minutesLeft: 30 },
  { kind: 'bonus-accrued', to: 1n, line: 1, amount: Money.toAmount('120') },
  {
    kind: 'withdrawal-request-status',
    to: 1n,
    status: 'new',
    amount: Money.toAmount('120'),
  },
  {
    kind: 'withdrawal-request-status',
    to: 1n,
    status: 'approved',
    amount: Money.toAmount('120'),
  },
  {
    kind: 'withdrawal-request-status',
    to: 1n,
    status: 'paid',
    amount: Money.toAmount('120'),
  },
  {
    kind: 'withdrawal-request-status',
    to: 1n,
    status: 'rejected',
    amount: Money.toAmount('120'),
    rejectReason: 'реквизит отозван',
  },
  { kind: 'card-application-status', to: 1n, status: 'submitted' },
  { kind: 'card-application-status', to: 1n, status: 'cancelled' },
  { kind: 'card-application-status', to: 1n, status: 'processing' },
  { kind: 'card-application-status', to: 1n, status: 'active' },
  { kind: 'card-application-status', to: 1n, status: 'rejected' },
  { kind: 'client-message-received', to: 1n },
];

describe('тексты бота', () => {
  it.each(Object.entries(BOT_TEXTS))('%s набран человеком', (_key, text) => {
    expect(slopComplaints(text)).toEqual([]);
  });

  it('описание до нажатия «Начать» набрано человеком', () => {
    expect(slopComplaints(BOT_DESCRIPTION)).toEqual([]);
  });

  it('строка о боте набрана человеком', () => {
    expect(slopComplaints(BOT_SHORT_DESCRIPTION)).toEqual([]);
  });

  /*
   * Пределы Telegram: описание длиннее их он не примет, и узнать об этом
   * при развёртывании значит узнать после того, как текст согласовали.
   */
  it('умещается в пределы, которые принимает Telegram', () => {
    expect(BOT_DESCRIPTION.length).toBeLessThanOrEqual(512);
    expect(BOT_SHORT_DESCRIPTION.length).toBeLessThanOrEqual(120);
  });

  it.each(EVERY_NOTIFICATION.map((one) => [`${one.kind}`, one] as const))(
    'уведомление %s набрано человеком',
    (_name, notification) => {
      expect(slopComplaints(renderNotification(notification))).toEqual([]);
    },
  );
});
