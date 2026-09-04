import { describe, expect, it } from 'vitest';
import { slopComplaints } from './bot-slop';
import { BOT_DESCRIPTION, BOT_SHORT_DESCRIPTION, BOT_TEXTS } from './bot-texts';
import { notificationKinds, renderNotification, type Notification } from './notifications';
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

/**
 * Обороты, по которым машинный набор узнают без счёта знаков.
 *
 * Примеры взяты из ленты dev-бота 7 августа 2026: так отвечала модель,
 * пока её держали одними запретами в запросе.
 */
describe('заученные обороты', () => {
  it('ловит приписку вежливости в конце', () => {
    expect(
      slopComplaints('Курс назовёт менеджер. Если у вас есть вопросы, обращайтесь.'),
    ).toHaveLength(1);
  });

  it('ловит «рады помочь»', () => {
    expect(slopComplaints('Рады помочь! Обращайтесь.')).not.toEqual([]);
  });

  /*
   * Хвост без адресата: «пишите, помогу» стоит в конце любого ответа и
   * ничего к нему не добавляет. Взят из живого прогона — правило про
   * «если у вас есть вопросы» его не ловило, а читается он так же.
   */
  it('ловит хвост «пишите, помогу»', () => {
    expect(
      slopComplaints('Меняем USDT на рубли. Если нужно уточнить — пишите, помогу.'),
    ).toHaveLength(1);
  });

  it('оставляет обещание позвать менеджера: оно называет, что будет дальше', () => {
    expect(
      slopComplaints('Если деньги уже ушли — напишите сюда, позову менеджера.'),
    ).toEqual([]);
  });

  it('ловит затакт перед ответом', () => {
    expect(slopComplaints('Отличный вопрос. Курс виден до подачи заявки.')).toHaveLength(1);
  });

  it('ловит «важно отметить»', () => {
    expect(slopComplaints('Важно отметить, что курс держится час.')).toHaveLength(1);
  });

  it('ловит связку «не только X, но и Y»', () => {
    expect(
      slopComplaints('Мы меняем не только USDT, но и рубли.'),
    ).toHaveLength(1);
  });

  it('ловит канцелярит', () => {
    expect(slopComplaints('Обмен осуществляется в кратчайшие сроки.')).not.toEqual([]);
  });

  it('ловит «предоставляем услуги»', () => {
    expect(
      slopComplaints('Мы предоставляем услуги обмена по данным направлениям.'),
    ).not.toEqual([]);
  });

  /*
   * Живая речь этих правил не задевает: сервис говорит короткими
   * фразами о деле, и запрет оборота не должен запрещать слово.
   */
  it('пропускает обычный ответ о деле', () => {
    expect(
      slopComplaints('Меняем рубли на баты. Курс виден до подачи заявки, там же и сумма.'),
    ).toEqual([]);
  });

  it('пропускает слово «менеджер» рядом с вопросом клиента', () => {
    expect(
      slopComplaints('Про вашу заявку ответит менеджер, он видит её целиком.'),
    ).toEqual([]);
  });
});

/**
 * Уведомление каждого вида: их читают люди, и каждое — текст сервиса.
 *
 * Не только клиентские. Сотруднику текст пишет тот же сервис, и «новая
 * заявка на обмен», набранная столбцом связок, читается машинной ровно
 * так же — а правит её тот же человек и тем же заходом.
 */
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
  {
    kind: 'staff-new-request',
    to: 1n,
    clientId: 2n,
    clientUsername: 'ivan',
    request: {
      kind: 'exchange',
      id: 'r',
      fromAmount: Money.toAmount('100'),
      fromCode: 'USDT',
      toCode: 'THB',
      isCash: false,
      toAmount: Money.toAmount('3267'),
      rate: Money.toAmount('32.67'),
      payout: { kind: 'account', bankName: 'Kasikorn', network: null },
    },
  },
  {
    kind: 'staff-new-request',
    to: 1n,
    clientId: 2n,
    clientUsername: null,
    request: {
      kind: 'exchange',
      id: 'r',
      fromAmount: Money.toAmount('100'),
      fromCode: 'USDT',
      toCode: 'RUB',
      isCash: true,
      toAmount: null,
      rate: null,
      payout: null,
    },
  },
  {
    kind: 'staff-new-request',
    to: 1n,
    clientId: 2n,
    clientUsername: 'ivan',
    request: { kind: 'withdrawal', id: 'w', amount: Money.toAmount('500'), method: 'bank', payout: null },
  },
  {
    kind: 'staff-new-request',
    to: 1n,
    clientId: 2n,
    clientUsername: 'ivan',
    request: { kind: 'card', id: 'c' },
  },
  {
    kind: 'staff-stale-request',
    to: 1n,
    clientId: 2n,
    clientUsername: 'ivan',
    request: {
      kind: 'exchange',
      id: 'r',
      fromAmount: Money.toAmount('100'),
      fromCode: 'USDT',
      toCode: 'THB',
      isCash: false,
      toAmount: Money.toAmount('3267'),
      rate: Money.toAmount('32.67'),
      payout: { kind: 'account', bankName: 'Kasikorn', network: null },
    },
    waitingMinutes: 45,
  },
  {
    // Больше двух часов: срок называется часами, и это другая строка.
    kind: 'staff-stale-request',
    to: 1n,
    clientId: 2n,
    clientUsername: null,
    request: {
      kind: 'exchange',
      id: 'r',
      fromAmount: Money.toAmount('100'),
      fromCode: 'USDT',
      toCode: 'RUB',
      isCash: true,
      toAmount: null,
      rate: null,
      payout: null,
    },
    waitingMinutes: 214,
  },
];

/**
 * Виды, чей текст здесь не проверяется, и почему.
 *
 * Четыре из пяти — про чужой набор: в обращении клиента, в сводке
 * эскалации и в напоминании о ждущем сервису принадлежит рамка, а
 * внутри стоит написанное самим клиентом; ответ менеджера уходит
 * дословно и целиком его. Падал бы этот тест от чужого сообщения с
 * тремя тире, а правит его не разработчик.
 *
 * Пятый — ответ консьержа. Он как раз наш, но пишется не здесь и не
 * заранее: его набирает модель, и то же самое правило применяется к
 * нему заставой в момент ответа (`concierge-guard.ts`). Образец с
 * чистым текстом доказывал бы только то, что чистый текст чист.
 */
const NOT_OURS: readonly Notification['kind'][] = [
  'staff-client-message',
  'staff-escalation',
  'staff-waiting-client',
  'manager-message',
  'concierge-message',
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
      expect(slopComplaints(renderNotification(notification).text)).toEqual([]);
    },
  );

  /*
   * Список выше набран руками, и заведённый следом вид уведомления в
   * него не попадает сам. Без этой проверки он прошёл бы мимо правила
   * молча — а замечают такое не на ревью, а через полгода, читая
   * сообщение, которое сервис уже отправил.
   */
  it('проверкой охвачен каждый вид уведомления', () => {
    const covered = new Set(EVERY_NOTIFICATION.map((one) => one.kind));
    const missed = notificationKinds.filter(
      (kind) => !covered.has(kind) && !NOT_OURS.includes(kind),
    );

    expect(missed).toEqual([]);
  });
});
