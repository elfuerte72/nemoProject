import { ATTACHMENT_DOWNLOAD_LIMIT_BYTES } from '@nemo/types';
import { describe, expect, it } from 'vitest';
import config from '../next.config';
import { KNOWLEDGE_FILE_LIMIT_BYTES } from './knowledge-file-kinds';

/**
 * Настройки сборки панели, которых глазом не видно.
 */

async function headersFor(): Promise<Record<string, string>> {
  const rules = (await config.headers?.()) ?? [];
  const all = rules.find((rule) => rule.source === '/:path*');
  return Object.fromEntries((all?.headers ?? []).map((one) => [one.key.toLowerCase(), one.value]));
}

/** Размер из настройки Next: `'25mb'` — мебибайты, как считает сам Next. */
function bytesOf(size: string | number | undefined): number {
  if (typeof size === 'number') return size;
  const match = /^(\d+)mb$/i.exec(size ?? '');
  if (!match) throw new Error(`Размер не распознан: ${String(size)}`);
  return Number(match[1]) * 1024 * 1024;
}

/*
 * Проверка «запрос только со своей страницы» ничего не стоит, если
 * саму страницу панели можно встроить во фрейм на чужом `*.sslip.io` и
 * подложить под клик менеджера: запрос тогда уходит с нашей страницы и
 * проверку проходит. Замечено ревью 17 сентября 2026.
 */
describe('заголовки безопасности панели', () => {
  it('страницу нельзя встроить во фрейм', async () => {
    expect((await headersFor())['x-frame-options']).toBe('DENY');
  });

  it('только https, тип содержимого не угадывается, адрес наружу не утекает', async () => {
    const headers = await headersFor();
    expect(headers['strict-transport-security']).toMatch(/max-age=\d{7,}/);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(config.poweredByHeader).toBe(false);
  });

  /*
   * Next 15 ставит заголовок из настройки первым, а одноимённый
   * заголовок маршрута после этого не записывает
   * (`next/dist/server/send-response.js`). Общая политика содержимого
   * заменила бы у файла клиента его `sandbox` (`lib/attachment-response.ts`)
   * — и PDF, показанный в строке, снова дотягивался бы до сессии
   * менеджера. Фрейм поэтому запрещает `X-Frame-Options`, а политику
   * содержимого ставит тот ответ, которому она нужна.
   */
  it('общей политики содержимого нет: она перетёрла бы песочницу у файла клиента', async () => {
    expect((await headersFor())['content-security-policy']).toBeUndefined();
  });
});

/*
 * При `middleware` Next копирует тело запроса для него и по умолчанию
 * обрезает копию на 10 МБ — маршрут получает только их. 17 сентября
 * 2026 на dev документ в базу знаний на 15 МБ отвечал 500 вместо «Файл
 * больше 10 МБ», а файл клиенту до 20 МБ, который панель пускает, не
 * разбирался вовсе.
 */
describe('предел тела запроса за middleware', () => {
  it('не меньше самого большого файла, который панель принимает, с запасом на обвязку', () => {
    const limit = bytesOf(config.experimental?.middlewareClientMaxBodySize);
    const largest = Math.max(ATTACHMENT_DOWNLOAD_LIMIT_BYTES, KNOWLEDGE_FILE_LIMIT_BYTES);
    expect(limit).toBeGreaterThanOrEqual(largest + 1024 * 1024);
  });
});
