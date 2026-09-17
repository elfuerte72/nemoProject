import { describe, expect, it } from 'vitest';
import { crossSiteComplaint, publicHost, type RequestFacts, type SameOriginRules } from './same-origin.js';

/**
 * Правило одно на кабинет и панель, а состав у каждого свой: какие
 * маршруты ходят не по куке и какие принимают файл. Здесь проверяется
 * само правило; состав — у приложений, рядом с их `middleware`.
 */

const RULES: SameOriginRules = {
  complaint: 'Запрос пришёл не со страницы сервиса.',
  notCookie: ['/api/v1/', '/api/hook'],
  multipart: ['/api/files'],
};

const SAME: RequestFacts = {
  method: 'POST',
  pathname: '/api/staff',
  origin: 'https://panel.example',
  fetchSite: 'same-origin',
  host: 'panel.example',
  contentType: 'application/json',
};

describe('изменяющий запрос — только со своей страницы', () => {
  it('со своей страницы с JSON — пропускается', () => {
    expect(crossSiteComplaint(SAME, RULES)).toBeNull();
    expect(crossSiteComplaint({ ...SAME, contentType: 'application/json; charset=utf-8' }, RULES)).toBeNull();
  });

  it('чтение не проверяется', () => {
    const read = { ...SAME, method: 'get', origin: 'https://evil.example', fetchSite: 'cross-site' };
    expect(crossSiteComplaint(read, RULES)).toBeNull();
  });

  it('отказ говорит словами приложения', () => {
    expect(crossSiteComplaint({ ...SAME, origin: 'https://evil-1-2-3-4.sslip.io' }, RULES)).toBe(RULES.complaint);
  });

  it('чужой Origin, соседний сайт и тело не JSON — отказ', () => {
    expect(crossSiteComplaint({ ...SAME, origin: 'null', fetchSite: null }, RULES)).not.toBeNull();
    expect(crossSiteComplaint({ ...SAME, origin: null, fetchSite: 'same-site' }, RULES)).not.toBeNull();
    expect(crossSiteComplaint({ ...SAME, contentType: 'text/plain;charset=UTF-8' }, RULES)).not.toBeNull();
    expect(crossSiteComplaint({ ...SAME, host: 'localhost:3000' }, RULES)).not.toBeNull();
  });

  it('не браузер — ни Origin, ни Sec-Fetch-Site — пропускается', () => {
    expect(crossSiteComplaint({ ...SAME, origin: null, fetchSite: null }, RULES)).toBeNull();
  });
});

describe('маршруты не на куке', () => {
  const foreign = { ...SAME, origin: 'https://evil.example', fetchSite: 'cross-site', contentType: 'text/plain' };

  it('запись с косой чертой — всё, что под ней', () => {
    expect(crossSiteComplaint({ ...foreign, pathname: '/api/v1/exchange-requests' }, RULES)).toBeNull();
  });

  it('запись без косой черты — ровно этот адрес, а не всё, что с него начинается', () => {
    expect(crossSiteComplaint({ ...foreign, pathname: '/api/hook' }, RULES)).toBeNull();
    expect(crossSiteComplaint({ ...foreign, pathname: '/api/hooked' }, RULES)).not.toBeNull();
    expect(crossSiteComplaint({ ...foreign, pathname: '/api/hook/extra' }, RULES)).not.toBeNull();
  });
});

describe('маршруты, принимающие файл', () => {
  const upload = { ...SAME, pathname: '/api/files', contentType: 'multipart/form-data; boundary=x' };

  it('файл со своей страницы — пропускается, и только на названном адресе', () => {
    expect(crossSiteComplaint(upload, RULES)).toBeNull();
    expect(crossSiteComplaint({ ...upload, pathname: '/api/staff' }, RULES)).not.toBeNull();
  });

  it('файл с чужой страницы — отказ: форму с файлом чужая страница отправляет без спроса', () => {
    expect(crossSiteComplaint({ ...upload, origin: 'https://evil-1-2-3-4.sslip.io', fetchSite: 'same-site' }, RULES)).not.toBeNull();
  });

  /*
   * Форму чужая страница шлёт без разрешения CORS, и держит её здесь
   * только `Origin`. Поэтому на адресе с файлом запрос без единого
   * признака своей страницы не проходит: «не браузер» сюда не ходит.
   */
  it('файл без Origin и без Sec-Fetch-Site — отказ', () => {
    expect(crossSiteComplaint({ ...upload, origin: null, fetchSite: null }, RULES)).not.toBeNull();
  });

  it('прочее не-JSON на адресе с файлом — отказ', () => {
    expect(crossSiteComplaint({ ...upload, contentType: 'text/plain' }, RULES)).not.toBeNull();
  });
});

describe('хост за прокси', () => {
  it('первый из x-forwarded-host, иначе host', () => {
    expect(publicHost(new Headers({ host: 'localhost:3000', 'x-forwarded-host': 'panel.example, inner' }))).toBe('panel.example');
    expect(publicHost(new Headers({ host: 'localhost:3000' }))).toBe('localhost:3000');
  });
});
