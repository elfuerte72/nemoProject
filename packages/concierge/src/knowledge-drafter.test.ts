import { describe, expect, it } from 'vitest';
import { createDeepSeekKnowledgeDrafter } from './knowledge-drafter.js';

/**
 * Разбор документа на статьи: сборка запроса и чтение ответа.
 *
 * Как и у консьержа, ответ провайдера записан фикстурой: тест,
 * собранный из представления о чужом API, проверяет представление, а
 * не API. Формат статей в ответе — договор этого модуля с моделью, и
 * проверяется он здесь, а не в ядре.
 */

/** Ответ DeepSeek на Anthropic-совместимом эндпоинте и то, что мы ему послали. */
function givenModel(text: string, stopReason: 'end_turn' | 'max_tokens' = 'end_turn') {
  const sent: { url: string; body: Record<string, unknown> }[] = [];

  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });

    return new Response(
      JSON.stringify({
        id: 'msg_01Draft',
        type: 'message',
        role: 'assistant',
        model: 'deepseek-chat',
        content: [{ type: 'text', text }],
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: 1210, output_tokens: 240 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;

  return { fetch, sent };
}

function drafterWith(fetch: typeof globalThis.fetch) {
  return createDeepSeekKnowledgeDrafter({
    apiKey: 'sk-test-key',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-chat',
    fetch,
  });
}

const REQUEST = {
  instructions: 'Ты — редактор базы знаний.',
  text: 'Работаем круглосуточно. Оплата по СБП.',
};

/** Как модель размечает статьи: строка «# Название», под ней текст. */
const TWO_ARTICLES = [
  '# График работы',
  'Сервис работает круглосуточно и без выходных.',
  '',
  '# Оплата',
  'Оплата проходит по СБП или переводом на карту.',
  'Реквизиты выдаёт менеджер по заявке.',
].join('\n');

describe('ответ модели', () => {
  it('читается статьями по строкам «# Название»', async () => {
    const { fetch } = givenModel(TWO_ARTICLES);

    const draft = await drafterWith(fetch).draft(REQUEST);

    expect(draft).toEqual({
      articles: [
        { title: 'График работы', body: 'Сервис работает круглосуточно и без выходных.' },
        {
          title: 'Оплата',
          body: 'Оплата проходит по СБП или переводом на карту.\nРеквизиты выдаёт менеджер по заявке.',
        },
      ],
      truncated: false,
    });
  });

  it('вступление до первой статьи не считает статьёй', async () => {
    const { fetch } = givenModel(`Вот статьи из документа:\n\n${TWO_ARTICLES}`);

    const draft = await drafterWith(fetch).draft(REQUEST);

    expect(draft?.articles.map((one) => one.title)).toEqual(['График работы', 'Оплата']);
  });

  it('заголовок с лишними решётками и пробелами читает как название', async () => {
    const { fetch } = givenModel('##  Наличные  \nКурс называет менеджер.');

    const draft = await drafterWith(fetch).draft(REQUEST);

    expect(draft?.articles).toEqual([{ title: 'Наличные', body: 'Курс называет менеджер.' }]);
  });

  it('знак «фактов нет» читает как пустой черновик, а не как статью', async () => {
    const { fetch } = givenModel('ПУСТО');

    expect(await drafterWith(fetch).draft(REQUEST)).toEqual({ articles: [], truncated: false });
  });

  it('ответ без единого заголовка — пустой черновик: сочинять название за модель нельзя', async () => {
    const { fetch } = givenModel('Сервис работает круглосуточно.');

    expect(await drafterWith(fetch).draft(REQUEST)).toEqual({ articles: [], truncated: false });
  });

  it('упёршись в потолок, отбрасывает оборванную последнюю статью и говорит об этом', async () => {
    const { fetch } = givenModel(TWO_ARTICLES, 'max_tokens');

    const draft = await drafterWith(fetch).draft(REQUEST);

    expect(draft?.articles.map((one) => one.title)).toEqual(['График работы']);
    expect(draft?.truncated).toBe(true);
  });
});

describe('запрос', () => {
  it('уходит на адрес провайдера', async () => {
    const { fetch, sent } = givenModel(TWO_ARTICLES);

    await drafterWith(fetch).draft(REQUEST);

    expect(sent[0]?.url).toBe('https://api.deepseek.com/anthropic/v1/messages');
  });

  it('несёт инструкцию редактора и формат в системной части, документ — сообщением', async () => {
    const { fetch, sent } = givenModel(TWO_ARTICLES);

    await drafterWith(fetch).draft(REQUEST);

    const system = String(sent[0]?.body.system);
    expect(system).toContain('Ты — редактор базы знаний.');
    expect(system).toContain('# Название');
    expect(system).toContain('ПУСТО');
    expect(sent[0]?.body.messages).toEqual([
      { role: 'user', content: 'Работаем круглосуточно. Оплата по СБП.' },
    ]);
  });

  it('выключает думание и не просит того, чего у совместимого слоя нет', async () => {
    const { fetch, sent } = givenModel(TWO_ARTICLES);

    await drafterWith(fetch).draft(REQUEST);

    expect(sent[0]?.body.thinking).toEqual({ type: 'disabled' });
    expect(sent[0]?.body).not.toHaveProperty('output_config');
  });
});

describe('молчание провайдера', () => {
  it('возвращает null, а не бросает: администратор повторит позже', async () => {
    const fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;

    expect(await drafterWith(fetch).draft(REQUEST)).toBeNull();
  });

  it('отказ провайдера — тоже молчание', async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'overloaded' } }), {
        status: 529,
        headers: { 'content-type': 'application/json' },
      })) as typeof globalThis.fetch;

    expect(await drafterWith(fetch).draft(REQUEST)).toBeNull();
  });
});
