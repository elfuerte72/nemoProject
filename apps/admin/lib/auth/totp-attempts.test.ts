import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetTotpAttempts,
  TOO_MANY_CODES,
  TOTP_ATTEMPT_LIMIT,
  TOTP_ATTEMPT_WINDOW_MS,
  withTotpAttempts,
} from './totp-attempts';

/**
 * Предел попыток кода второго фактора.
 *
 * 17 сентября 2026 проверка прислала панели двадцать пять неверных
 * кодов подряд — двадцать пять одинаковых отказов, и двадцать шестой
 * принимался бы так же. Подходят одновременно три кода из миллиона, а
 * незавершённый вход перевыпускается повтором первого шага: с угнанным
 * Telegram сотрудника — тем случаем, ради которого второй фактор и
 * заведён, — код подбирался со скоростью сети.
 *
 * Проверяется тестом, потому что руками это шесть промахов подряд, а
 * ошибка выглядит как работающий вход.
 */

/** Отказ ядра так, как он приходит из чужой копии `@nemo/core`. */
function denied(): Error {
  return Object.assign(new Error('Вход не выполнен'), { code: 'forbidden' });
}

const wrongCode = () => Promise.reject(denied());
const rightCode = () => Promise.resolve({ role: 'manager' as const });

async function miss(staffId: string, times: number, now: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await expect(withTotpAttempts(staffId, wrongCode, now)).rejects.toThrow('Вход не выполнен');
  }
}

beforeEach(() => {
  forgetTotpAttempts();
});

describe('предел попыток кода', () => {
  it('после предела отказывает, не спрашивая ядро, — даже верному коду', async () => {
    await miss('anna', TOTP_ATTEMPT_LIMIT, 1_000);

    const complete = vi.fn(rightCode);
    await expect(withTotpAttempts('anna', complete, 1_000)).rejects.toThrow(TOO_MANY_CODES);
    expect(complete).not.toHaveBeenCalled();
  });

  it('отказ по пределу — отказ ядра с кодом: форма печатает его слова', async () => {
    await miss('anna', TOTP_ATTEMPT_LIMIT, 1_000);
    await expect(withTotpAttempts('anna', rightCode, 1_000)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('считает по сотруднику: перебор у одного не запирает другого', async () => {
    await miss('anna', TOTP_ATTEMPT_LIMIT, 1_000);
    await expect(withTotpAttempts('petr', rightCode, 1_000)).resolves.toEqual({ role: 'manager' });
  });

  /*
   * Ключ — сотрудник, а не кука незавершённого входа: куку перебирающий
   * перевыпускает повтором первого шага, и счёт по ней начинался бы
   * заново каждые пять минут.
   */
  it('окно кончается — попытки возвращаются', async () => {
    await miss('anna', TOTP_ATTEMPT_LIMIT, 1_000);
    await expect(
      withTotpAttempts('anna', rightCode, 1_000 + TOTP_ATTEMPT_WINDOW_MS),
    ).resolves.toEqual({ role: 'manager' });
  });

  it('промахи до предела входу не мешают, а вход их снимает', async () => {
    await miss('anna', TOTP_ATTEMPT_LIMIT - 1, 1_000);
    await expect(withTotpAttempts('anna', rightCode, 1_000)).resolves.toEqual({ role: 'manager' });

    await miss('anna', TOTP_ATTEMPT_LIMIT - 1, 2_000);
    await expect(withTotpAttempts('anna', rightCode, 2_000)).resolves.toEqual({ role: 'manager' });
  });

  it('о закрытом входе сообщает один раз — на промахе, исчерпавшем предел', async () => {
    const onLocked = vi.fn();
    for (let i = 0; i < TOTP_ATTEMPT_LIMIT + 3; i += 1) {
      await withTotpAttempts('anna', wrongCode, 1_000, onLocked).catch(() => undefined);
    }
    expect(onLocked).toHaveBeenCalledTimes(1);
  });

  /*
   * Перебирающий не ждёт ответа, прежде чем послать следующий код. Если
   * попытка списывается только по ответу ядра, сотня кодов, пришедших
   * разом, проходит проверку предела раньше, чем первый успел списаться,
   * — и предел не ограничивает ничего.
   */
  it('коды, пришедшие разом, до ядра доходят не сверх предела', async () => {
    const complete = vi.fn(
      () => new Promise<never>((_, reject) => setTimeout(() => reject(denied()), 5)),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () => withTotpAttempts('anna', complete, 1_000)),
    );

    expect(complete).toHaveBeenCalledTimes(TOTP_ATTEMPT_LIMIT);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
  });

  it('отказавшая база — не попытка подбора', async () => {
    const down = () => Promise.reject(new Error('connect ECONNREFUSED'));
    for (let i = 0; i < TOTP_ATTEMPT_LIMIT + 2; i += 1) {
      await expect(withTotpAttempts('anna', down, 1_000)).rejects.toThrow('ECONNREFUSED');
    }
    await expect(withTotpAttempts('anna', rightCode, 1_000)).resolves.toEqual({ role: 'manager' });
  });

  it('предел позволяет опечататься и не даёт перебирать', () => {
    expect(TOTP_ATTEMPT_LIMIT).toBeGreaterThanOrEqual(3);
    expect(TOTP_ATTEMPT_LIMIT).toBeLessThanOrEqual(10);
    expect(TOTP_ATTEMPT_WINDOW_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });
});
