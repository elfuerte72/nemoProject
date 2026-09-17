import { describe, expect, it } from 'vitest';
import config from '../next.config';

/**
 * Заголовки безопасности кабинета.
 *
 * Глазом их не видно, а без них разбор 14 сентября 2026 нашёл ответ
 * только с `x-powered-by: Next.js`: раздел «Сотрудники» и выпуск ключа
 * API можно было встроить во фрейм на чужой странице и подложить под
 * клик владельца.
 */

async function headersFor(): Promise<Record<string, string>> {
  const rules = (await config.headers?.()) ?? [];
  const all = rules.find((rule) => rule.source === '/:path*');
  return Object.fromEntries((all?.headers ?? []).map((one) => [one.key.toLowerCase(), one.value]));
}

describe('заголовки безопасности', () => {
  it('страницу нельзя встроить во фрейм', async () => {
    const headers = await headersFor();
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('только https, тип содержимого не угадывается, адрес наружу не утекает', async () => {
    const headers = await headersFor();
    expect(headers['strict-transport-security']).toMatch(/max-age=\d{7,}/);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('движок сервера не называется', () => {
    expect(config.poweredByHeader).toBe(false);
  });
});
