import { afterEach, describe, expect, it, vi } from 'vitest';
import { toClient, toMerchant, type Notification } from '@nemo/core';
import accepted from './fixtures/resend-accepted.json' with { type: 'json' };
import rejected from './fixtures/resend-rejected.json' with { type: 'json' };
import {
  deliverNotifications,
  hasMerchantMail,
  mailWorks,
  readMailEnvironment,
  type MailDelivery,
  type MailOptions,
} from './index.js';

/**
 * Доставка писем. Живого запроса здесь нет: ответы провайдера записаны
 * фикстурами — тест, сочинённый по памяти о формате, проверяет не
 * провайдера, а представление о нём.
 */

const MERCHANT = toMerchant({ id: 'm1', email: 'shop@example.com' });
const PROVIDER: MailDelivery = { mode: 'provider', apiKey: 're_test', from: 'Tobee <no@t.ru>' };

const VERIFICATION: Notification = {
  kind: 'merchant-email-verification',
  to: MERCHANT,
  token: 'a b/c',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('почта из окружения', () => {
  const CABINET = { CABINET_URL: 'https://business.tobee.ru' };

  it('провайдер требует ключ и отправителя', () => {
    expect(
      readMailEnvironment({
        ...CABINET,
        EMAIL_DELIVERY: 'provider',
        EMAIL_API_KEY: 're_x',
        EMAIL_FROM: 'a@b.ru',
      }).delivery,
    ).toEqual({ mode: 'provider', apiKey: 're_x', from: 'a@b.ru' });

    const half = readMailEnvironment({
      ...CABINET,
      EMAIL_DELIVERY: 'provider',
      EMAIL_API_KEY: 're_x',
    }).delivery;
    expect(half.mode).toBe('off');
    expect(mailWorks(half)).toBe(false);
  });

  it('журнал включается словом, а не отсутствием ключа', () => {
    expect(readMailEnvironment({ ...CABINET, EMAIL_DELIVERY: 'log' }).delivery).toEqual({
      mode: 'log',
    });
  });

  /*
   * Письмо без адреса кабинета доходит, но сделать по нему нечего:
   * подтверждение почты и сброс пароля — это ссылка и есть.
   */
  it('без адреса кабинета почта выключена', () => {
    const off = readMailEnvironment({ EMAIL_DELIVERY: 'log' }).delivery;
    expect(off.mode).toBe('off');
    if (off.mode === 'off') expect(off.complaint).toContain('CABINET_URL');
  });

  /*
   * Молчащая подстановка журнала на боевом контуре означала бы, что
   * письма настоящим мерчантам исчезают, а деплой выглядит рабочим.
   */
  it('без переменной почта выключена и говорит, чего не хватает', () => {
    const off = readMailEnvironment(CABINET).delivery;
    expect(off.mode).toBe('off');
    expect(mailWorks(off)).toBe(false);
    if (off.mode === 'off') expect(off.complaint).toContain('EMAIL_DELIVERY');
  });

  it('незнакомый режим — тоже отказ, а не тихий провайдер', () => {
    expect(readMailEnvironment({ ...CABINET, EMAIL_DELIVERY: 'smtp' }).delivery.mode).toBe('off');
  });
});

describe('письмо провайдеру', () => {
  it('уходит одним запросом: адрес, тема, текст и ссылка из ключа', async () => {
    const call = fetchReturning(accepted, 200);
    await deliverNotifications([VERIFICATION], options({ delivery: PROVIDER, fetch: call }));

    expect(call).toHaveBeenCalledTimes(1);
    const [url, init] = call.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test');

    const body = JSON.parse(String(init.body)) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
    };
    expect(body.to).toEqual(['shop@example.com']);
    expect(body.subject).toBe('Подтвердите почту');
    // Ключ в ссылке экранирован: в нём бывают знаки, которые адрес
    // разрежут пополам, и половина ключа не подтверждает ничего.
    expect(body.text).toContain('https://business.tobee.ru/verify?token=a%20b%2Fc');
    expect(body.text).toContain('Кабинет: https://business.tobee.ru');
    expect(body.text).toContain('Поддержка: https://t.me/tobee_help');
  });

  it('отказ провайдера не бросает: заявка уже исполнена', async () => {
    const call = fetchReturning(rejected, 422);
    const complained = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      deliverNotifications([VERIFICATION], options({ delivery: PROVIDER, fetch: call })),
    ).resolves.toBeUndefined();
    expect(complained).toHaveBeenCalled();
  });

  it('сеть, которой нет, тоже не бросает', async () => {
    const call = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      deliverNotifications(
        [VERIFICATION],
        options({ delivery: PROVIDER, fetch: call as unknown as typeof fetch }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('режим журнала', () => {
  it('пишет письмо со ссылкой: её забирают из журнала контейнера', async () => {
    const written = vi.spyOn(console, 'info').mockImplementation(() => {});
    await deliverNotifications([VERIFICATION], options({ delivery: { mode: 'log' } }));

    const line = String(written.mock.calls[0]?.[0]);
    expect(line).toContain('shop@example.com');
    expect(line).toContain('/verify?token=a%20b%2Fc');
  });
});

describe('чужие уведомления', () => {
  it('клиентское письмом не уходит', async () => {
    const call = fetchReturning(accepted, 200);
    await deliverNotifications(
      [
        {
          kind: 'exchange-request-status',
          to: toClient(42n),
          requestId: 'r1',
          status: 'completed',
        },
        { kind: 'client-message-received', to: 42n },
      ],
      options({ delivery: PROVIDER, fetch: call }),
    );

    expect(call).not.toHaveBeenCalled();
  });

  /*
   * Заявку мерчант подал сам и ответ видел: письма о принятой заявке
   * нет, и доставка на ней молчит — иначе на каждый шаг приходило бы по
   * письму, и то, где ждут оплаты, потерялось бы среди них.
   */
  it('письма среди уведомлений видно до похода в базу', () => {
    expect(hasMerchantMail([{ kind: 'client-message-received', to: 42n }])).toBe(false);
    expect(hasMerchantMail([VERIFICATION])).toBe(true);
  });

  it('переход, о котором письма нет, ничего не отправляет', async () => {
    const call = fetchReturning(accepted, 200);
    await deliverNotifications(
      [{ kind: 'exchange-request-status', to: MERCHANT, requestId: 'r1', status: 'new' }],
      options({ delivery: PROVIDER, fetch: call }),
    );

    expect(call).not.toHaveBeenCalled();
  });
});

describe('выключенная почта', () => {
  it('не отправляет и жалуется в журнал, но не бросает', async () => {
    const complained = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      deliverNotifications(
        [VERIFICATION],
        options({ delivery: { mode: 'off', complaint: 'не задан EMAIL_DELIVERY' } }),
      ),
    ).resolves.toBeUndefined();
    expect(complained).toHaveBeenCalled();
  });
});

function options(over: Partial<MailOptions> & { delivery: MailDelivery }): MailOptions {
  return {
    cabinetUrl: 'https://business.tobee.ru/',
    supportUsername: 'tobee_help',
    ...over,
  };
}

function fetchReturning(body: unknown, status: number) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  ) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}
