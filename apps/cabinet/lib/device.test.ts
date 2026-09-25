import { describe, expect, it } from 'vitest';
import { deviceLabel } from './device';

/**
 * Устройство словами — в «Сессиях»: по нему человек узнаёт свой вход и
 * находит чужой. Строки браузера — настоящие, снятые с тех браузеров,
 * которыми открывают кабинет; порядок проверок в них важен — Edge,
 * Opera и Яндекс называют себя ещё и Chrome, а Chrome — ещё и Safari.
 */

const CASES: readonly [string, string][] = [
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'macOS · Chrome',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    'macOS · Safari',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.42',
    'Windows · Edge',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
    'Windows · Firefox',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.7.0.0 Safari/537.36',
    'Windows · Яндекс Браузер',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/113.0.0.0',
    'Windows · Opera',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'iPhone · Safari',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1',
    'iPhone · Chrome',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.127 Mobile Safari/537.36',
    'Android · Chrome',
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Linux · Chrome',
  ],
];

describe('устройство словами', () => {
  it.each(CASES)('%s', (userAgent, label) => {
    expect(deviceLabel(userAgent)).toBe(label);
  });

  it('незнакомый браузер — только система, без выдумки', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) SomeBrowser/1.0')).toBe('Windows');
  });

  it('не браузер — первое слово строки: curl, скрипт, библиотека', () => {
    expect(deviceLabel('curl/8.7.1')).toBe('curl');
    expect(deviceLabel('python-requests/2.32.3')).toBe('python-requests');
  });

  it('пустая строка — «неизвестное устройство», а не пустая ячейка', () => {
    expect(deviceLabel(null)).toBe('Неизвестное устройство');
    expect(deviceLabel('   ')).toBe('Неизвестное устройство');
  });
});
