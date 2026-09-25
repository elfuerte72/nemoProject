import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '@nemo/core';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { issueToken, readToken, SessionError, viewerOrElse } from './session';

/**
 * Подписанная кука кабинета.
 *
 * Проверяется здесь то, чего не видно глазами: подпись, срок и номер
 * сессии. Ошибка в любом из трёх выглядит как работающий вход — и
 * обнаруживается тем, что в кабинет зашёл не тот.
 */

const secret = 'x'.repeat(32);
const options = { secret };
const USER = '3f1c2a9e-5b7d-4c0e-9a11-2f6d8e4b7c31';
const SESSION = '7d3c1e0b-5d0a-4a8e-9f3e-2c1b7d4a9e10';

describe('кука сессии', () => {
  it('переживает выдачу и чтение', () => {
    const token = issueToken({ userId: USER, sessionId: SESSION }, options);
    expect(readToken(token, options)).toEqual({ userId: USER, sessionId: SESSION });
  });

  it('подделанная не читается: подпись покрывает всё, включая номер сессии', () => {
    const token = issueToken({ userId: USER, sessionId: SESSION }, options);
    const [id, session, expires, signature] = token.split('.');
    const other = '00000000-0000-4000-8000-000000000000';

    expect(() => readToken(`${other}.${session}.${expires}.${signature}`, options)).toThrow(
      SessionError,
    );
    expect(() => readToken(`${id}.${other}.${expires}.${signature}`, options)).toThrow(SessionError);
    expect(() => readToken(token, { secret: 'y'.repeat(32) })).toThrow(SessionError);
  });

  it('истёкшая не читается', () => {
    const token = issueToken(
      { userId: USER, sessionId: SESSION },
      { ...options, expiresAt: new Date('2026-09-06T10:01:00Z') },
    );
    expect(() =>
      readToken(token, { ...options, now: new Date('2026-09-06T10:01:01Z') }),
    ).toThrow(SessionError);
  });

  it('срок куки — срок записи о входе, до секунды', () => {
    const expiresAt = new Date('2026-10-24T10:00:00.700Z');
    const token = issueToken({ userId: USER, sessionId: SESSION }, { ...options, expiresAt });
    expect(token.split('.')[2]).toBe(String(Math.floor(expiresAt.getTime() / 1000)));
  });

  it('пустая и обрезанная — тоже отказ, а не пустая сессия', () => {
    expect(() => readToken(undefined, options)).toThrow(SessionError);
    expect(() => readToken('', options)).toThrow(SessionError);
    expect(() => readToken('m1.1.999', options)).toThrow(SessionError);
  });

  /*
   * До 24 сентября 2026 вторым полем куки было поколение, числом. Такая
   * кука подписана тем же секретом и подпись проходит — но номер сессии
   * из неё не выйдет, и в базу с ним ходить нельзя: запрос с «1» вместо
   * uuid падал бы пятисотым. После выката каждый входит заново.
   */
  it('кука прежнего вида — отказ «войдите заново», а не поход в базу', () => {
    const forged = `${USER}.1.${Math.floor(Date.now() / 1000) + 3600}`;
    expect(() => readToken(`${forged}.${signOf(forged)}`, options)).toThrow(SessionError);
  });
});

function signOf(body: string): string {
  // Тот же способ подписи, что и в модуле: тест подделывает не подпись,
  // а содержимое — и должен пройти проверку подписи, чтобы дойти до него.
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
describe('разделы кабинета амбассадора читают сессию только через ambassadorPage()', () => {
  const root = join(__dirname, '..', 'app', '(ambassador)');
  const screens = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((name) =>
    /(^|\/)(page|layout)\.tsx$/.test(name),
  );

  it('разделы есть', () => {
    expect(screens.length).toBeGreaterThan(3);
  });

  /*
   * То же правило и по той же причине, что у разделов мерчанта: каркас
   * и раздел под ним рисуются параллельно, и раздел с прямым
   * `requireAmbassador` без сессии пишет ошибку в журнал вместо тихого
   * ухода на витрину. Каркасу читать напрямую можно — он один и сам
   * решает, что показать без отметки; страницам нельзя.
   */
  it.each(screens.filter((name) => name.endsWith('page.tsx')))('%s', (name) => {
    const source = readFileSync(join(root, name), 'utf8');
    expect(source).not.toMatch(/\b(requireAmbassador|readAmbassadorToken|ambassadorOrNull)\b/);
  });
});

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
