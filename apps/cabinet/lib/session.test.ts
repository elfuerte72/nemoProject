import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '@nemo/core';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { issueToken, readToken, SessionError, viewerOrElse } from './session';

/**
 * Подписанная кука кабинета.
 *
 * Проверяется здесь то, чего не видно глазами: подпись, срок и
 * поколение. Ошибка в любом из трёх выглядит как работающий вход — и
 * обнаруживается тем, что в кабинет зашёл не тот.
 */

const secret = 'x'.repeat(32);
const options = { secret };

describe('кука сессии', () => {
  it('переживает выдачу и чтение', () => {
    const token = issueToken({ merchantId: 'm1', sessionEpoch: 3 }, options);
    expect(readToken(token, options)).toEqual({ merchantId: 'm1', sessionEpoch: 3 });
  });

  it('подделанная не читается: подпись покрывает всё, включая поколение', () => {
    const token = issueToken({ merchantId: 'm1', sessionEpoch: 3 }, options);
    const [id, epoch, expires, signature] = token.split('.');

    expect(() => readToken(`m2.${epoch}.${expires}.${signature}`, options)).toThrow(SessionError);
    expect(() => readToken(`${id}.9.${expires}.${signature}`, options)).toThrow(SessionError);
    expect(() => readToken(token, { secret: 'y'.repeat(32) })).toThrow(SessionError);
  });

  it('истёкшая не читается', () => {
    const token = issueToken(
      { merchantId: 'm1', sessionEpoch: 1 },
      { ...options, ttlSeconds: 60, now: new Date('2026-09-06T10:00:00Z') },
    );
    expect(() =>
      readToken(token, { ...options, now: new Date('2026-09-06T10:01:01Z') }),
    ).toThrow(SessionError);
  });

  it('пустая и обрезанная — тоже отказ, а не пустая сессия', () => {
    expect(() => readToken(undefined, options)).toThrow(SessionError);
    expect(() => readToken('', options)).toThrow(SessionError);
    expect(() => readToken('m1.1.999', options)).toThrow(SessionError);
  });

  /*
   * Поколение читается числом: строка в этом месте прошла бы сверку с
   * поколением из базы только по случайности, а не пройдя её — выкинула
   * бы из кабинета того, чья кука в порядке.
   */
  it('поколение не число — отказ', () => {
    const token = issueToken({ merchantId: 'm1', sessionEpoch: 1 }, options);
    const [id, , expires] = token.split('.');
    const forged = `${id}.первое.${expires}`;
    expect(() => readToken(`${forged}.${signOf(forged)}`, options)).toThrow(SessionError);
  });
});

function signOf(body: string): string {
  // Тот же способ подписи, что и в модуле: тест подделывает не подпись,
  // а поколение — и должен пройти проверку подписи, чтобы дойти до него.
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/**
 * Страница без сессии уходит на вход, а не падает.
 *
 * Каркас кабинета и раздел под ним читают сессию параллельно: каркас
 * делал редирект, а раздел успевал бросить отказ — посетитель получал
 * свой 307, но в журнал контейнера на каждый заход без сессии ложилась
 * «ошибка». Замечено 7 сентября 2026 на песочнице: журнал — то место,
 * где ищут настоящие поломки, и ложная строка на каждого выходящего
 * из сессии там стоит внимания.
 */
describe('viewerOrElse', () => {
  const signIn = (): never => {
    throw new Error('NEXT_REDIRECT');
  };

  it('без сессии зовёт вход, а отказ чтения наружу не отдаёт', async () => {
    await expect(
      viewerOrElse(async () => {
        throw new SessionError('Нет сессии');
      }, signIn),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('на отказ ядра «forbidden» — тоже вход: поколение сменилось или мерчанта нет', async () => {
    await expect(
      viewerOrElse(async () => {
        throw new ForbiddenError('Сессия устарела');
      }, signIn),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('чужую ошибку отдаёт как есть', async () => {
    await expect(
      viewerOrElse(async () => {
        throw new Error('база не ответила');
      }, signIn),
    ).rejects.toThrow('база не ответила');
  });

  it('с сессией отдаёт прочитанное', async () => {
    await expect(viewerOrElse(async () => ({ merchantId: 'm1' }), signIn)).resolves.toEqual({
      merchantId: 'm1',
    });
  });

  it('странице входа отдаёт то, что она попросила вместо отказа', async () => {
    await expect(
      viewerOrElse(async () => {
        throw new SessionError('Нет сессии');
      }, () => null),
    ).resolves.toBeNull();
  });
});

/**
 * Правило, которое теряется молча: раздел под `(cabinet)` читает сессию
 * только через `viewer()` из `lib/reads.ts`. Страница с прямым
 * `requireViewer` рисуется параллельно с каркасом и без сессии снова
 * пишет ошибку в журнал — заметит это только тот, кто в журнал
 * заглянет. Тест того же рода, что и проверка порядка запуска в Mini App.
 */
describe('страницы кабинета читают сессию только через viewer()', () => {
  const root = join(__dirname, '..', 'app', '(cabinet)');
  const screens = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((name) =>
    /(^|\/)(page|layout)\.tsx$/.test(name),
  );

  it('разделы есть', () => {
    expect(screens.length).toBeGreaterThan(5);
  });

  it.each(screens)('%s', (name) => {
    const source = readFileSync(join(root, name), 'utf8');
    expect(source).not.toMatch(/\b(requireViewer|requireActor|readToken|viewerOrNull)\b/);
  });
});
