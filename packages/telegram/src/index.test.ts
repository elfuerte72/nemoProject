import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewRequestSubject, Notification } from '@nemo/core';
import { deliverNotifications } from './index';

/** Тела запросов к Bot API за один вызов доставки, по порядку. */
async function sentBodies(
  notifications: readonly Notification[],
  panelUrl?: string,
): Promise<Record<string, unknown>[]> {
  const fetched = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetched);

  await deliverNotifications(notifications, {
    botToken: 't',
    ...(panelUrl ? { panelUrl } : {}),
  });

  return fetched.mock.calls.map((call: unknown[]) => {
    const init = call[1] as { body: string };
    return JSON.parse(init.body) as Record<string, unknown>;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = { to: 1n, clientId: 2n, clientUsername: 'ivan' } as const;
type Exchange = Extract<NewRequestSubject, { kind: 'exchange' }>;
const exchange: Exchange = {
  kind: 'exchange',
  id: 'r1',
  fromAmount: '100' as Exchange['fromAmount'],
  fromCode: 'USDT',
  toCode: 'RUB',
  isCash: false,
};

/*
 * Сотрудник разбирать повод идёт в панель, и у каждого повода есть
 * кнопка туда: обращение, эскалация и ждущий клиент ведут в переписку,
 * новая и забытая заявка — в заявку. Эскалация без кнопки уже уходила:
 * «помощник передал разговор» — и ни слова о том, где отвечать.
 */
describe('deliverNotifications: сотруднику', () => {
  it.each<[Notification, string, string]>([
    [
      { kind: 'staff-client-message', ...client, preview: 'Привет' },
      'Открыть переписку',
      '/conversations/2',
    ],
    [
      { kind: 'staff-escalation', ...client, reason: 'клиент просит менеджера', preview: 'Ау' },
      'Открыть переписку',
      '/conversations/2',
    ],
    [
      { kind: 'staff-waiting-client', ...client, preview: 'Ау', waitingMinutes: 30 },
      'Открыть переписку',
      '/conversations/2',
    ],
    [
      { kind: 'staff-new-request', ...client, request: exchange },
      'Открыть заявку',
      '/exchange-requests/r1',
    ],
    [
      { kind: 'staff-stale-request', ...client, request: exchange, waitingMinutes: 45 },
      'Открыть заявку',
      '/exchange-requests/r1',
    ],
  ])('%o уходит с разметкой и кнопкой в панель', async (notification, label, path) => {
    const [body] = await sentBodies([notification], 'https://panel.example/');

    expect(body).toMatchObject({
      chat_id: '1',
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: label, url: `https://panel.example${path}` }]],
      },
    });
  });

  it('без адреса панели кнопки нет, разметка остаётся', async () => {
    const [body] = await sentBodies([{ kind: 'staff-client-message', ...client, preview: 'Привет' }]);

    expect(body).toMatchObject({ parse_mode: 'HTML' });
    expect(body).not.toHaveProperty('reply_markup');
  });
});

describe('deliverNotifications: клиенту', () => {
  it('голый текст, без разметки и без кнопки', async () => {
    const [body] = await sentBodies(
      [{ kind: 'manager-message', to: 5n, body: 'a < b' }],
      'https://panel.example',
    );

    expect(body).toEqual({ chat_id: '5', text: '[Оператор]: a < b' });
  });
});
