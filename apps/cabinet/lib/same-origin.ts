/**
 * Изменяющий запрос к кабинету — только со страницы самого кабинета.
 *
 * Сессия кабинета — кука, и браузер приносит её с любым запросом к
 * нашему адресу, откуда бы тот ни шёл. `SameSite=Lax` отсекает чужие
 * сайты, но «сайт» браузер считает по списку публичных суффиксов, а
 * `sslip.io`, на котором кабинет живёт до своего домена, в этом списке
 * нет: страница на любом `*.sslip.io` для браузера тот же сайт. 14
 * сентября 2026 на dev запрос телом `text/plain` с чужого поддомена
 * завёл сотрудника в кабинет вошедшего владельца.
 *
 * Поэтому проверка своя и не зависит от домена. Отказ получает
 * изменяющий запрос, если браузер сам назвал его пришедшим не с нашей
 * страницы (`Sec-Fetch-Site`), если его `Origin` — не наш хост, или если
 * тело не JSON: с чужой страницы без разрешения CORS JSON не отправить,
 * а форма и `text/plain` уходят без спроса.
 *
 * Запрос без `Origin` и без `Sec-Fetch-Site` пропускается: так не ходит
 * ни один нынешний браузер, а подделать запрос можно только в браузере
 * жертвы. Чтение не проверяется — опасно изменение, а не взгляд.
 */

export interface RequestFacts {
  readonly method: string;
  readonly pathname: string;
  readonly origin: string | null;
  /** `Sec-Fetch-Site`: `same-origin`, `same-site`, `cross-site` или `none`. */
  readonly fetchSite: string | null;
  /** Хост кабинета, как его видит браузер: за прокси — `x-forwarded-host`. */
  readonly host: string | null;
  readonly contentType: string | null;
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Маршруты не на куке. API v1 входит ключом из заголовка и зовётся
 * сервером мерчанта, у которого нет ни `Origin`, ни нашей страницы;
 * планировщик — секретом. Подделать чужой ключ браузер не может.
 */
const NOT_COOKIE = ['/api/v1/', '/api/maintenance/'];

export const CROSS_SITE_COMPLAINT =
  'Запрос пришёл не со страницы кабинета. Откройте кабинет и повторите действие там.';

export function crossSiteComplaint(facts: RequestFacts): string | null {
  if (READS.has(facts.method.toUpperCase())) return null;
  if (NOT_COOKIE.some((prefix) => facts.pathname.startsWith(prefix))) return null;

  const site = facts.fetchSite?.toLowerCase();
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    return CROSS_SITE_COMPLAINT;
  }

  if (facts.origin !== null && hostOf(facts.origin) !== facts.host?.toLowerCase()) {
    return CROSS_SITE_COMPLAINT;
  }

  if (facts.contentType !== null) {
    const media = facts.contentType.split(';')[0]!.trim().toLowerCase();
    if (media !== 'application/json') return CROSS_SITE_COMPLAINT;
  }

  return null;
}

/** Хост из `Origin`; `null` и мусор не совпадают ни с чем. */
function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Хост кабинета за прокси: первый из `x-forwarded-host`, иначе `host`. */
export function publicHost(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  return forwarded || headers.get('host');
}
