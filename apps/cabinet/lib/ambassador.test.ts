import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Третий путь к клиентскому `Actor`.
 *
 * Клиента опознаёт подпись запуска Mini App, мерчанта — сессия кабинета
 * и ключ API; кабинет амбассадора добавляет третий путь, и ошибка в нём
 * выглядит как работающий вход — просто заходит в кабинет не тот. В
 * `actor.ts` это записано прямо: собрать актора из непроверенного
 * запроса — ошибка адаптера, которую ничем, кроме внимательности, не
 * поймать. Отсюда правила ниже: проверка живёт в одном месте, и мимо
 * неё актора не собрать.
 */

const source = readFileSync(join(__dirname, 'ambassador.ts'), 'utf8');

describe('актор амбассадора собирается после двух проверок', () => {
  it('идентификатор берётся из подписанной куки, а не из запроса', () => {
    expect(source).toContain('readAmbassadorToken');
    // Ни заголовка, ни параметра адреса: ими распоряжается пришедший.
    expect(source).not.toMatch(/headers\(\)|searchParams|request\.(json|url)/);
  });

  it('право входа спрашивается у ядра при каждом запросе', () => {
    expect(source).toContain('signInAmbassador');
  });

  it('актор собирается из того, что вернуло ядро, а не из куки', () => {
    expect(source).toContain("{ type: 'client', telegramUserId: session.clientId }");
  });
});

/**
 * И то же правило с другой стороны: клиентский актор рождается в одном
 * модуле. Второе такое место — второй шанс собрать его из чужих цифр.
 */
describe('мимо этого модуля актора не собирают', () => {
  const app = join(__dirname, '..', 'app');
  const files = readdirSync(app, { recursive: true, encoding: 'utf8' }).filter((name) =>
    /\.tsx?$/.test(name),
  );

  it('экраны и маршруты есть', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s', (name) => {
    expect(readFileSync(join(app, name), 'utf8')).not.toMatch(/type:\s*'client'/);
  });
});
