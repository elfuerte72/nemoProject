import { afterEach, describe, expect, it, vi } from 'vitest';
import { nudgeStaffAlerts } from './staff-alert';

/**
 * Толчок в панель: клиентский деплой просит её разослать сотрудникам то,
 * что только что случилось.
 *
 * Проверяется здесь то, чего не видно ни глазом, ни прогоном ядра:
 * адрес, секрет и способ отказа. Ошибиться тут можно молча — панель
 * ответит отказом, клиент своего ответа не потеряет, а менеджер просто
 * узнает о заявке через период расписания вместо секунды. Заметить это
 * без теста нечем.
 *
 * Сеть подменяется, потому что настоящая панель в тест не позовётся, а
 * проверяется не она: что она ответит, здесь не важно вовсе.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Ответ панели, какого от неё ждут. Тело не читается — только код. */
function givenPanelAnswers(status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }));
}

describe('толчок в панель', () => {
  it('стучится в маршрут рассылки секретом планировщика', async () => {
    vi.stubEnv('ADMIN_URL', 'https://panel.example');
    vi.stubEnv('SCHEDULER_SECRET', 'секрет');
    const fetched = givenPanelAnswers();

    nudgeStaffAlerts();

    expect(fetched).toHaveBeenCalledWith('https://panel.example/api/staff/notify', {
      method: 'POST',
      headers: { authorization: 'Bearer секрет' },
    });
  });

  it('не удваивает косую черту, если адрес панели ею кончается', async () => {
    // Адрес приходит из переменной окружения, и косая черта в конце —
    // самая частая опечатка при её заполнении. Двойная в пути даёт 404,
    // то есть тишину вместо уведомлений.
    vi.stubEnv('ADMIN_URL', 'https://panel.example/');
    vi.stubEnv('SCHEDULER_SECRET', 'секрет');
    const fetched = givenPanelAnswers();

    nudgeStaffAlerts();

    expect(fetched).toHaveBeenCalledWith(
      'https://panel.example/api/staff/notify',
      expect.anything(),
    );
  });

  it('молчит в сеть, пока панель не настроена', async () => {
    vi.stubEnv('ADMIN_URL', '');
    vi.stubEnv('SCHEDULER_SECRET', '');
    const fetched = givenPanelAnswers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    nudgeStaffAlerts();

    expect(fetched).not.toHaveBeenCalled();
  });

  it('не роняет обработчик, когда панель недоступна', async () => {
    vi.stubEnv('ADMIN_URL', 'https://panel.example');
    vi.stubEnv('SCHEDULER_SECRET', 'секрет');
    const complained = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('сеть недоступна'));

    // Ответа никто не ждёт: клиент в этот момент ждёт своего. Отказ
    // обязан остаться отказом похода в панель, а не отказом операции.
    expect(() => nudgeStaffAlerts()).not.toThrow();

    await vi.waitFor(() => expect(complained).toHaveBeenCalled());
  });
});
