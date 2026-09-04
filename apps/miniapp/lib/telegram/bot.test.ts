import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Кто в боте отвечает на сообщение.
 *
 * Проверяется одно: файл доходит до операции, что бы ни было написано в
 * подписи к нему. grammY ищет и текст, и подпись — `hears` и `command`
 * оба смотрят `message.caption`, — и чек, подписанный словом «Поддержка»
 * или командой `/support`, уходил бы в меню: без записи, без
 * подтверждения, без уведомления сотрудникам. Ровно та потеря, ради
 * которой файлы и заводились.
 *
 * Правило это живёт в порядке регистрации обработчиков и теряется от
 * перестановки строк — глазами такое не ловится.
 */

const received: { body?: string; attachment?: { kind: string; name?: string } }[] = [];

vi.mock('@/lib/core', () => ({
  getCore: () => ({
    receiveClientMessage: (input: { body?: string; attachment?: { kind: string; name?: string } }) => {
      received.push(input);
      return Promise.resolve({ notifications: [] });
    },
    getBotText: () => 'Текст бота',
    getExchangeTerms: () => Promise.resolve({ pairs: [] }),
    answerAsConcierge: () => Promise.resolve({ notifications: [], handedToHuman: false }),
  }),
}));

vi.mock('@/lib/staff-alert', () => ({ nudgeStaffAlerts: () => undefined }));

vi.mock('@/lib/referral', () => ({ referralLink: () => 'https://example.com/?startapp=code' }));

process.env.TELEGRAM_BOT_TOKEN = '123:test';
process.env.MINIAPP_URL = 'https://example.com';

const { getBot } = await import('./bot');

const bot = getBot();
bot.botInfo = {
  id: 1,
  is_bot: true,
  first_name: 'Tobee',
  username: 'tobee_test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};
// Ответы бота наружу не уходят: проверяется, кто взялся за сообщение.
bot.api.config.use(() => Promise.resolve({ ok: true, result: true } as never));

const CHAT = { id: 100, type: 'private' as const, first_name: 'Иван' };
const FROM = { id: 100, is_bot: false, first_name: 'Иван' };

function update(message: Record<string, unknown>): Parameters<typeof bot.handleUpdate>[0] {
  return {
    update_id: 1,
    message: { message_id: 1, date: 1_756_900_000, chat: CHAT, from: FROM, ...message },
  } as Parameters<typeof bot.handleUpdate>[0];
}

const DOCUMENT = {
  file_id: 'BQACAgIAAxkBAAIC',
  file_unique_id: 'u1',
  file_name: 'чек.pdf',
  mime_type: 'application/pdf',
  file_size: 245_760,
};

beforeEach(() => {
  received.length = 0;
});

describe('файл с подписью', () => {
  it('доходит до операции, когда подписан словом из меню', async () => {
    await bot.handleUpdate(update({ document: DOCUMENT, caption: 'Поддержка' }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      body: 'Поддержка',
      attachment: { kind: 'document', name: 'чек.pdf' },
    });
  });

  it('доходит и тогда, когда подпись — команда', async () => {
    // Команду Telegram размечает в самой подписи — по этой разметке её и
    // ищет grammY, и без неё проверка была бы ни о чём.
    await bot.handleUpdate(
      update({
        document: DOCUMENT,
        caption: '/support',
        caption_entities: [{ type: 'bot_command', offset: 0, length: 8 }],
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]!.attachment).toMatchObject({ kind: 'document' });
  });

  it('и когда подписи нет вовсе', async () => {
    await bot.handleUpdate(update({ document: DOCUMENT }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ attachment: { name: 'чек.pdf' } });
    expect(received[0]!.body).toBeUndefined();
  });
});

describe('текст', () => {
  it('со словом из меню отвечается меню, а не обращением', async () => {
    await bot.handleUpdate(update({ text: 'Поддержка' }));

    expect(received).toEqual([]);
  });

  it('обычный уходит обращением', async () => {
    await bot.handleUpdate(update({ text: 'Когда придут деньги?' }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ body: 'Когда придут деньги?' });
    expect(received[0]!.attachment).toBeUndefined();
  });
});

describe('наклейка', () => {
  it('обращения не создаёт: ответа на неё не ждут', async () => {
    await bot.handleUpdate(
      update({ sticker: { file_id: 's', file_unique_id: 'u2', type: 'regular' } }),
    );

    expect(received).toEqual([]);
  });
});
