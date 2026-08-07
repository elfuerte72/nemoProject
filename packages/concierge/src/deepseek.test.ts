import { describe, expect, it } from 'vitest';
import { createDeepSeekConcierge } from './deepseek.js';
import type { ConciergeRequest } from '@nemo/core';

/**
 * Разговор с провайдером: сборка запроса и разбор ответа.
 *
 * Проверяется здесь, а не через операции ядра: как выглядит запрос к
 * чужому API и что приходит обратно — свойства самого источника, и база
 * для них не нужна.
 *
 * Ответ провайдера записан фикстурой, а не сочинён по памяти о формате:
 * тест, собранный из представления о чужом API, проверяет представление,
 * а не API.
 */

/** Ответ DeepSeek на Anthropic-совместимом эндпоинте и то, что мы ему послали. */
function givenModel(text: string) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];

  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });

    return new Response(
      JSON.stringify({
        id: 'msg_01XyZ',
        type: 'message',
        role: 'assistant',
        model: 'deepseek-chat',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 412, output_tokens: 37 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;

  return { fetch, sent };
}

function conciergeWith(fetch: typeof globalThis.fetch) {
  return createDeepSeekConcierge({
    // Латиницей: ключ уходит заголовком, а в заголовках только ASCII.
    // Настоящие ключи провайдера такие же.
    apiKey: 'sk-test-key',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-chat',
    fetch,
  });
}

const REQUEST: ConciergeRequest = {
  instructions: 'Ты помощник обменника.',
  facts: 'Курс USDT → RUB: 81,25.',
  conversation: [{ role: 'client', text: 'Какой курс?' }],
};

describe('ответ модели', () => {
  it('читается текстом', async () => {
    const { fetch } = givenModel('Сейчас курс 81,25 за USDT.');

    const answer = await conciergeWith(fetch).answer(REQUEST);

    expect(answer).toEqual({ reply: 'Сейчас курс 81,25 за USDT.', needsHuman: false });
  });

  it('просит человека сигнальной строкой', async () => {
    // Структурного вывода у совместимого эндпоинта нет, и просьба
    // приходит первой строкой ответа.
    const { fetch } = givenModel('МЕНЕДЖЕР');

    expect(await conciergeWith(fetch).answer(REQUEST)).toMatchObject({ needsHuman: true });
  });

  it('просит человека и с пояснением после сигнальной строки', async () => {
    const { fetch } = givenModel('МЕНЕДЖЕР\nВопрос про конкретную оплату.');

    expect(await conciergeWith(fetch).answer(REQUEST)).toMatchObject({ needsHuman: true });
  });

  it('не принимает за просьбу слово внутри ответа', async () => {
    const { fetch } = givenModel('Заявку возьмёт менеджер, он и назовёт курс.');

    expect(await conciergeWith(fetch).answer(REQUEST)).toMatchObject({ needsHuman: false });
  });
});

describe('запрос', () => {
  it('уходит на адрес провайдера', async () => {
    const { fetch, sent } = givenModel('Ответ');

    await conciergeWith(fetch).answer(REQUEST);

    expect(sent[0]?.url).toBe('https://api.deepseek.com/anthropic/v1/messages');
  });

  it('несёт справку и правила в системной части', async () => {
    const { fetch, sent } = givenModel('Ответ');

    await conciergeWith(fetch).answer(REQUEST);

    const system = String(sent[0]?.body.system);
    expect(system).toContain('Ты помощник обменника.');
    expect(system).toContain('Курс USDT → RUB: 81,25.');
  });

  it('выключает думание модели', async () => {
    /*
     * `deepseek-v4-flash` думает вслух и отдаёт блок размышления до
     * ответа — а потолок токенов покрывает оба. С думанием размышление
     * съедает бюджет, и клиенту достаётся обрезанный ответ или пустота;
     * пустоту застава отвергает, и разговор уходит человеку на ровном
     * месте. Проверено на живом провайдере 7 августа 2026: с думанием
     * 236 токенов, без него 140 и один текстовый блок.
     *
     * Размышление здесь и не нужно: консьерж отвечает короткой справкой
     * на вопрос поддержки, а не решает задачу.
     */
    const { fetch, sent } = givenModel('Ответ');

    await conciergeWith(fetch).answer(REQUEST);

    expect(sent[0]?.body.thinking).toEqual({ type: 'disabled' });
  });

  it('не просит у провайдера того, чего у него нет', async () => {
    // `effort` и структурный вывод — возможности Anthropic, а не
    // совместимого слоя: присланные ему, они вернулись бы отказом на
    // каждое сообщение клиента.
    const { fetch, sent } = givenModel('Ответ');

    await conciergeWith(fetch).answer(REQUEST);

    expect(sent[0]?.body).not.toHaveProperty('output_config');
  });

  it('склеивает подряд идущие сообщения одной стороны', async () => {
    // API ждёт чередования ролей, а клиент пишет три сообщения подряд.
    const { fetch, sent } = givenModel('Ответ');

    await conciergeWith(fetch).answer({
      ...REQUEST,
      conversation: [
        { role: 'client', text: 'Первый' },
        { role: 'client', text: 'Второй' },
        { role: 'service', text: 'Отвечаю' },
        { role: 'client', text: 'Третий' },
      ],
    });

    expect(sent[0]?.body.messages).toEqual([
      { role: 'user', content: 'Первый\nВторой' },
      { role: 'assistant', content: 'Отвечаю' },
      { role: 'user', content: 'Третий' },
    ]);
  });

  it('не начинает разговор с ответа сервиса: такой запрос API отвергает', async () => {
    const { fetch, sent } = givenModel('Ответ');

    await conciergeWith(fetch).answer({
      ...REQUEST,
      conversation: [
        { role: 'service', text: 'Обрезано по потолку' },
        { role: 'client', text: 'Вопрос' },
      ],
    });

    expect(sent[0]?.body.messages).toEqual([{ role: 'user', content: 'Вопрос' }]);
  });

  it('передаёт жалобы на прошлый ответ, чтобы повтор исправлял названное', async () => {
    const { fetch, sent } = givenModel('Ответ');

    await conciergeWith(fetch).answer({
      ...REQUEST,
      complaints: ['число «95» сервис не называл'],
    });

    expect(String(sent[0]?.body.system)).toContain('число «95» сервис не называл');
  });
});

describe('молчание провайдера', () => {
  it('возвращает пустой ответ, а не бросает: человек ответит вместо него', async () => {
    const fetch = (async () => {
      throw new Error('сеть недоступна');
    }) as typeof globalThis.fetch;

    expect(await conciergeWith(fetch).answer(REQUEST)).toBeNull();
  });

  it('так же отвечает на отказ провайдера', async () => {
    const fetch = (async () =>
      new Response('{"type":"error"}', { status: 503 })) as typeof globalThis.fetch;

    expect(await conciergeWith(fetch).answer(REQUEST)).toBeNull();
  });
});
