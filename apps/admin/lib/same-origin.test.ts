import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, middleware } from '../middleware';
import { PAGE_PATH_HEADER } from './auth/return-to';
import { PANEL_RULES, crossSiteComplaint, type RequestFacts } from './same-origin';

/**
 * Изменяющий запрос к панели — только со страницы самой панели.
 *
 * 17 сентября 2026 проверка нашла, что у панели этой защиты нет вовсе:
 * кабинет получил её тикетом 19, а панель — где заводят сотрудников,
 * называют курс и отвечают клиенту — держалась на одном `SameSite=Lax`.
 * Панель живёт на `*.sslip.io`, которого нет в списке публичных
 * суффиксов: страница на любом другом `*.sslip.io` для браузера тот же
 * сайт, и кука уходит с её запросом. Продакшен-сборка приняла
 * `POST /api/staff` телом `text/plain` с `Origin:
 * https://evil-1-2-3-4.sslip.io` от имени вошедшего администратора —
 * так посторонний заводится администратором.
 */

const SAME: RequestFacts = {
  method: 'POST',
  pathname: '/api/staff',
  origin: 'https://panel.example',
  fetchSite: 'same-origin',
  host: 'panel.example',
  contentType: 'application/json',
};

const FORGED: RequestFacts = {
  ...SAME,
  origin: 'https://evil-1-2-3-4.sslip.io',
  fetchSite: 'same-site',
  contentType: 'text/plain;charset=UTF-8',
};

describe('чей это запрос к панели', () => {
  it('со страницы панели — пропускается', () => {
    expect(crossSiteComplaint(SAME)).toBeNull();
    expect(crossSiteComplaint({ ...SAME, pathname: '/api/auth/logout', contentType: null })).toBeNull();
  });

  it('с соседнего поддомена sslip.io — отказ словами про панель', () => {
    expect(crossSiteComplaint(FORGED)).toMatch(/панел/);
    expect(crossSiteComplaint({ ...FORGED, pathname: '/api/exchange-requests/1' })).not.toBeNull();
    expect(crossSiteComplaint({ ...FORGED, pathname: '/api/auth/totp' })).not.toBeNull();
  });

  it('бот входа и толчок о новой заявке не проверяются: там секрет, а не кука', () => {
    expect(crossSiteComplaint({ ...FORGED, pathname: '/api/bot' })).toBeNull();
    expect(crossSiteComplaint({ ...FORGED, pathname: '/api/staff/notify' })).toBeNull();
    expect(crossSiteComplaint({ ...FORGED, pathname: '/api/conversations/notify' })).toBeNull();
  });

  /*
   * `/api/staff/notify` ходит по секрету, а `/api/staff` — по куке, и
   * это тот самый маршрут, которым заводят администратора. Исключение,
   * записанное началом адреса, открыло бы оба.
   */
  it('исключение для толчка не открывает заведение сотрудников', () => {
    expect(crossSiteComplaint({ ...FORGED, pathname: '/api/staff' })).not.toBeNull();
    expect(crossSiteComplaint({ ...FORGED, pathname: '/api/conversations' })).not.toBeNull();
  });

  it('файл клиенту и документ в базу знаний — со страницы панели проходят', () => {
    const upload = { ...SAME, contentType: 'multipart/form-data; boundary=x' };
    expect(crossSiteComplaint({ ...upload, pathname: '/api/conversations/attachments' })).toBeNull();
    expect(crossSiteComplaint({ ...upload, pathname: '/api/concierge/knowledge/draft' })).toBeNull();
    expect(crossSiteComplaint({ ...upload, pathname: '/api/staff' })).not.toBeNull();
    expect(
      crossSiteComplaint({ ...upload, pathname: '/api/conversations/attachments', origin: FORGED.origin, fetchSite: 'same-site' }),
    ).not.toBeNull();
  });
});

/*
 * Состав правил сверяется с маршрутами, а не держится на памяти:
 * маршрут с файлом, забытый в списке, отвечал бы менеджеру отказом на
 * каждую отправку; маршрут, убранный из приложения, оставлял бы в
 * списке дыру без хозяина.
 */
describe('состав правил сходится с маршрутами', () => {
  const api = fileURLToPath(new URL('../app/api', import.meta.url));

  function routes(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return routes(path);
      return entry.name === 'route.ts' ? [path] : [];
    });
  }

  function addressOf(file: string): string {
    const inner = relative(api, file).split(sep).slice(0, -1).join('/');
    return `/api/${inner}`;
  }

  it('файл принимают ровно те маршруты, что названы в правилах', () => {
    const uploads = routes(api)
      .filter((file) => readFileSync(file, 'utf8').includes('.formData()'))
      .map(addressOf)
      .sort();
    expect(uploads).toEqual([...(PANEL_RULES.multipart ?? [])].sort());
  });

  it('у каждого исключения есть маршрут, и входит он не по куке', () => {
    const known = new Map(routes(api).map((file) => [addressOf(file), readFileSync(file, 'utf8')]));
    for (const address of PANEL_RULES.notCookie) {
      const source = known.get(address);
      expect(source, address).toBeDefined();
      expect(source, address).not.toContain('requireStaffActor');
    }
  });
});

describe('middleware панели', () => {
  function request(path: string, headers: Record<string, string>, method = 'POST'): NextRequest {
    return new NextRequest(`http://localhost:3001${path}`, { method, headers });
  }

  it('стоит на всех маршрутах API', () => {
    for (const url of ['/api/staff', '/api/staff/notify', '/api/conversations/attachments']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true);
    }
  });

  /*
   * На страницах middleware ничего не запрещает: он кладёт в запрос путь
   * страницы, чтобы истёкшая сессия увела на вход с адресом возврата
   * (`lib/auth/return-to.ts`). Статика мимо: её отдают без сессии.
   */
  it('стоит на страницах, но не на статике', () => {
    for (const url of ['/', '/exchange-requests/abc', '/settings/staff', '/login']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true);
    }
    for (const url of ['/_next/static/chunks/main.js', '/_next/image', '/icon.svg']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(false);
    }
  });

  it('кладёт в запрос страницы её путь — свой, а не присланный браузером', () => {
    const response = middleware(
      request(
        '/exchange-requests/abc?request=1',
        { host: 'localhost:3001', [PAGE_PATH_HEADER]: '//evil.example' },
        'GET',
      ),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get(`x-middleware-request-${PAGE_PATH_HEADER}`)).toBe(
      '/exchange-requests/abc?request=1',
    );
  });

  it('маршрутам API путь страницы не нужен', () => {
    const response = middleware(request('/api/live', { host: 'localhost:3001' }, 'GET'));
    expect(response.headers.get(`x-middleware-request-${PAGE_PATH_HEADER}`)).toBeNull();
  });

  it('отвечает 403 словами на подделанный запрос', async () => {
    const response = middleware(
      request('/api/staff', {
        host: 'localhost:3001',
        'x-forwarded-host': 'panel.example',
        origin: 'https://evil-1-2-3-4.sslip.io',
        'sec-fetch-site': 'same-site',
        'content-type': 'text/plain;charset=UTF-8',
      }),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/панел/);
  });

  it('пропускает запрос со страницы панели дальше', () => {
    const response = middleware(
      request('/api/staff', {
        host: 'localhost:3001',
        'x-forwarded-host': 'panel.example',
        origin: 'https://panel.example',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      }),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
