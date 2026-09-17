/**
 * Изменяющий запрос — только со страницы самого приложения.
 *
 * Сессия и кабинета, и панели — кука, и браузер приносит её с любым
 * запросом к нашему адресу, откуда бы тот ни шёл. `SameSite=Lax`
 * отсекает чужие сайты, но «сайт» браузер считает по списку публичных
 * суффиксов, а `sslip.io`, на котором сервис живёт до своего домена, в
 * этом списке нет: страница на любом `*.sslip.io` для браузера тот же
 * сайт. 14 сентября 2026 на dev запрос телом `text/plain` с чужого
 * поддомена завёл сотрудника в кабинет вошедшего владельца; 17 сентября
 * тем же запросом продакшен-сборка панели согласилась завести
 * администратора.
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
 *
 * Правило одно, а состав у приложений свой — какие маршруты ходят не по
 * куке, какие принимают файл, какими словами отказать. Две копии
 * проверки — это два места, где её можно написать «помягче»; панель без
 * неё прожила три дня после того, как её получил кабинет.
 *
 * Модуль не тянет за собой ничего: `middleware` работает в пограничном
 * рантайме, где `@nemo/core` нет, — поэтому вход у него отдельный,
 * `@nemo/http/same-origin`, мимо `index.ts`.
 */

export interface RequestFacts {
  readonly method: string;
  readonly pathname: string;
  readonly origin: string | null;
  /** `Sec-Fetch-Site`: `same-origin`, `same-site`, `cross-site` или `none`. */
  readonly fetchSite: string | null;
  /** Хост приложения, как его видит браузер: за прокси — `x-forwarded-host`. */
  readonly host: string | null;
  readonly contentType: string | null;
}

export interface SameOriginRules {
  /** Слова отказа: человек должен понять, в какое приложение вернуться. */
  readonly complaint: string;
  /**
   * Маршруты не на куке — ключ, секрет планировщика, секрет вебхука.
   * Зовёт их сервер, у которого нет ни `Origin`, ни нашей страницы, а
   * подделать чужой секрет браузер не может.
   *
   * Запись с косой чертой на конце — всё, что под ней; без неё — ровно
   * этот адрес. Началом адреса по умолчанию считать нельзя: рядом с
   * `/api/staff/notify` на секрете живёт `/api/staff` на куке.
   */
  readonly notCookie: readonly string[];
  /** Маршруты, принимающие файл: ровно эти адреса, и только со своей страницы. */
  readonly multipart?: readonly string[];
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function crossSiteComplaint(facts: RequestFacts, rules: SameOriginRules): string | null {
  if (READS.has(facts.method.toUpperCase())) return null;
  if (rules.notCookie.some((entry) => covers(entry, facts.pathname))) return null;

  const site = facts.fetchSite?.toLowerCase();
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    return rules.complaint;
  }

  const ours = facts.origin !== null && hostOf(facts.origin) === facts.host?.toLowerCase();
  if (facts.origin !== null && !ours) {
    return rules.complaint;
  }

  if (facts.contentType !== null) {
    const media = facts.contentType.split(';')[0]!.trim().toLowerCase();
    if (media === 'multipart/form-data' && rules.multipart?.includes(facts.pathname)) {
      /*
       * Форму с файлом чужая страница отправляет без разрешения CORS, и
       * от подделки её отличает только то, что назвал браузер. Поэтому
       * здесь нужен признак своей страницы, а не отсутствие чужой:
       * «не браузер» файлы в приложение не носит.
       */
      return ours || site === 'same-origin' ? null : rules.complaint;
    }
    if (media !== 'application/json') return rules.complaint;
  }

  return null;
}

function covers(entry: string, pathname: string): boolean {
  return entry.endsWith('/') ? pathname.startsWith(entry) : pathname === entry;
}

/** Хост из `Origin`; `null` и мусор не совпадают ни с чем. */
function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Хост приложения за прокси: первый из `x-forwarded-host`, иначе `host`. */
export function publicHost(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  return forwarded || headers.get('host');
}
