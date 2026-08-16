import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Тексты, которыми запросная обвязка говорит с клиентом.
 *
 * Ей одной видны все отказы всех экранов, поэтому и совет «что делать»
 * живёт здесь, а не в каждом экране по-своему. Проверяются ровно
 * тексты: их не видно глазами до того, как сервер откажет, а отказ по
 * просроченной подписи воспроизводится только сутками ожидания.
 */

const getInitData = vi.hoisted(() => vi.fn<() => string | undefined>());

vi.mock('@/lib/telegram/webapp', () => ({ getInitData }));

import { ApiError, get, SESSION_STALE_MESSAGE } from './client-api';

function givenServerAnswer(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  getInitData.mockReset();
});

describe('отказ в узнавании запуска', () => {
  it('серверный 401 говорит, что делать, а не что случилось', async () => {
    getInitData.mockReturnValue('signed');
    givenServerAnswer(401, { error: 'Не удалось подтвердить запуск' });

    const failure = await get('/api/quote').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(401);
    // Серверная формулировка нейтральна намеренно — по подробной
    // подбирали бы подпись. Человеку вместо неё называется выход.
    expect((failure as ApiError).message).toBe(SESSION_STALE_MESSAGE);
  });

  it('совет держит выход на людей: переоткрытие помогает не всегда', () => {
    // Тем же отказом оборачивается слетевший на сервере токен — там
    // переоткрытие не помогает, сколько ни повторяй, и совет без
    // выхода водил бы по кругу.
    expect(SESSION_STALE_MESSAGE).toMatch(/напишите/i);
  });

  it('открытому не из Telegram советуется Telegram, а не переоткрытие', async () => {
    getInitData.mockReturnValue(undefined);
    givenServerAnswer(200, {});

    const failure = await get('/api/quote').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toBe('Откройте приложение из Telegram');
  });

  it('прочие отказы сервера доходят своими словами', async () => {
    getInitData.mockReturnValue('signed');
    givenServerAnswer(409, { error: 'Заявка уже отменена' });

    const failure = await get('/api/anything').catch((error: unknown) => error);

    expect((failure as ApiError).message).toBe('Заявка уже отменена');
  });
});
