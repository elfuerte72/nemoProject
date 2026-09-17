import { describe, expect, it } from 'vitest';
import { loginPath, safeReturnPath } from './return-to';

/**
 * Куда вернуть человека после входа.
 *
 * Кнопка «Открыть заявку» из уведомления в Telegram ведёт в карточку, а
 * сессия живёт двенадцать часов: до 17 сентября 2026 истёкшая сессия
 * уводила на вход, и после входа менеджер попадал на стол, а заявку
 * искал заново.
 *
 * Адрес возврата приходит в адресе страницы входа, и написать туда можно
 * что угодно: ссылку «войдите в панель» с чужим сайтом в хвосте пришлёт
 * кто угодно. Поэтому возвращает панель только к себе — относительным
 * путём этого же приложения.
 */

describe('адрес возврата после входа', () => {
  it('путь своей страницы сохраняется вместе с параметрами', () => {
    expect(safeReturnPath('/exchange-requests/0f6c7a52-1b1e-4c1a-9d59-2d1c4f5e6a7b')).toBe(
      '/exchange-requests/0f6c7a52-1b1e-4c1a-9d59-2d1c4f5e6a7b',
    );
    expect(safeReturnPath('/conversations/5003?request=abc')).toBe('/conversations/5003?request=abc');
    expect(safeReturnPath('/?kind=cash&q=%D0%B0')).toBe('/?kind=cash&q=%D0%B0');
  });

  it('чужой сайт не принимается ни в каком написании', () => {
    for (const hostile of [
      'https://evil.example',
      'http://evil.example/exchange-requests/1',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/..//evil.example',
      '/.//evil.example',
      ' //evil.example',
      'javascript:alert(1)',
      'evil.example',
      'https:evil.example',
    ]) {
      expect(safeReturnPath(hostile), JSON.stringify(hostile)).toBeNull();
    }
  });

  it('пустое, вход и маршруты API — не туда, куда шёл человек', () => {
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath('')).toBeNull();
    expect(safeReturnPath('/login')).toBeNull();
    expect(safeReturnPath('/login?next=%2F')).toBeNull();
    expect(safeReturnPath('/api/auth/logout')).toBeNull();
  });

  it('адрес входа несёт путь возврата, а чужой сайт — нет', () => {
    expect(loginPath('/exchange-requests/abc')).toBe('/login?next=%2Fexchange-requests%2Fabc');
    expect(loginPath('/withdrawals?x=1')).toBe('/login?next=%2Fwithdrawals%3Fx%3D1');
    expect(loginPath('/')).toBe('/login');
    expect(loginPath(null)).toBe('/login');
    expect(loginPath('//evil.example')).toBe('/login');
    expect(loginPath('https://evil.example')).toBe('/login');
  });
});
