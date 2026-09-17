import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from '../middleware';
import { crossSiteComplaint, type RequestFacts } from './same-origin';

/**
 * Изменяющий запрос к кабинету — только со страницы самого кабинета.
 *
 * Кука сессии `SameSite=Lax`, но пока кабинет живёт на `*.sslip.io`, её
 * не хватает: `sslip.io` нет в списке публичных суффиксов, и страница на
 * любом другом `*.sslip.io` для браузера тот же сайт. 14 сентября 2026
 * на dev запрос телом `text/plain` с `Origin: https://evil-1-2-3-4.sslip.io`
 * завёл сотрудника в кабинет вошедшего владельца — 201.
 */

const SAME: RequestFacts = {
  method: 'POST',
  pathname: '/api/staff',
  origin: 'https://cab.example',
  fetchSite: 'same-origin',
  host: 'cab.example',
  contentType: 'application/json',
};

describe('чей это запрос', () => {
  it('со страницы кабинета с JSON — пропускается', () => {
    expect(crossSiteComplaint(SAME)).toBeNull();
    expect(crossSiteComplaint({ ...SAME, contentType: 'application/json; charset=utf-8' })).toBeNull();
  });

  it('чтение не проверяется: подделка опасна изменением, а не взглядом', () => {
    expect(
      crossSiteComplaint({ ...SAME, method: 'GET', origin: 'https://evil.example', fetchSite: 'cross-site' }),
    ).toBeNull();
  });

  it('чужой Origin — отказ, даже соседний поддомен того же sslip.io', () => {
    expect(crossSiteComplaint({ ...SAME, origin: 'https://evil-1-2-3-4.sslip.io', fetchSite: null })).not.toBeNull();
    expect(crossSiteComplaint({ ...SAME, origin: 'null', fetchSite: null })).not.toBeNull();
  });

  it('браузер назвал запрос соседним или чужим — отказ, даже без Origin', () => {
    expect(crossSiteComplaint({ ...SAME, origin: null, fetchSite: 'same-site' })).not.toBeNull();
    expect(crossSiteComplaint({ ...SAME, origin: null, fetchSite: 'cross-site' })).not.toBeNull();
  });

  it('тело не JSON — отказ: формой с чужой страницы JSON не отправить', () => {
    expect(crossSiteComplaint({ ...SAME, contentType: 'text/plain;charset=UTF-8' })).not.toBeNull();
    expect(crossSiteComplaint({ ...SAME, contentType: 'application/x-www-form-urlencoded' })).not.toBeNull();
    expect(crossSiteComplaint({ ...SAME, contentType: 'multipart/form-data; boundary=x' })).not.toBeNull();
  });

  it('запрос без тела со страницы кабинета — выход — пропускается', () => {
    expect(crossSiteComplaint({ ...SAME, pathname: '/api/auth/logout', contentType: null })).toBeNull();
  });

  it('не браузер — ни Origin, ни Sec-Fetch-Site — пропускается: подделать запрос можно только чужими руками в браузере', () => {
    expect(crossSiteComplaint({ ...SAME, origin: null, fetchSite: null })).toBeNull();
  });

  it('API v1 и планировщик не проверяются: там не кука, а ключ и секрет', () => {
    const foreign = { ...SAME, origin: 'https://evil.example', fetchSite: 'cross-site', contentType: 'text/plain' };
    expect(crossSiteComplaint({ ...foreign, pathname: '/api/v1/exchange-requests' })).toBeNull();
    expect(crossSiteComplaint({ ...foreign, pathname: '/api/maintenance/purge-logs' })).toBeNull();
  });

  it('хост за прокси берётся из x-forwarded-host', () => {
    expect(crossSiteComplaint({ ...SAME, host: 'cab.example' })).toBeNull();
    expect(crossSiteComplaint({ ...SAME, host: 'localhost:3000' })).not.toBeNull();
  });
});

describe('middleware кабинета', () => {
  function request(path: string, headers: Record<string, string>, method = 'POST'): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, { method, headers });
  }

  it('отвечает 403 словами на подделанный запрос', async () => {
    const response = middleware(
      request('/api/staff', {
        host: 'localhost:3000',
        'x-forwarded-host': 'cab.example',
        origin: 'https://evil-1-2-3-4.sslip.io',
        'sec-fetch-site': 'same-site',
        'content-type': 'text/plain;charset=UTF-8',
      }),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/страниц/);
  });

  it('пропускает запрос со страницы кабинета дальше', () => {
    const response = middleware(
      request('/api/staff', {
        host: 'localhost:3000',
        'x-forwarded-host': 'cab.example',
        origin: 'https://cab.example',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      }),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
