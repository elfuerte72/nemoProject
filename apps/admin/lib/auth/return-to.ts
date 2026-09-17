/**
 * Куда вернуть человека после входа.
 *
 * Сессия панели живёт двенадцать часов, а кнопка «Открыть заявку» из
 * уведомления в Telegram ведёт в карточку заявки. До 17 сентября 2026
 * истёкшая сессия уводила на `/login` без адреса, и после входа менеджер
 * попадал на стол и искал заявку заново.
 *
 * Страница не знает своего адреса: у серверного компонента Next его нет.
 * Поэтому путь кладёт в запрос `middleware` (`PAGE_PATH_HEADER`), а
 * обёртка `requireStaffPage` уводит на вход с ним в `?next=`.
 *
 * Адрес возврата — только относительный путь этого же приложения. В
 * адрес страницы входа написать можно что угодно, и ссылку «войдите в
 * панель» с чужим сайтом в хвосте пришлёт кто угодно; вход, уводящий на
 * чужую страницу, похожую на панель, — готовый способ выманить код
 * второго фактора. Модуль без зависимостей: его читает `middleware`, а
 * тот работает в пограничном рантайме.
 */

/** Заголовок запроса страницы с её путём. Ставит `middleware` поверх присланного. */
export const PAGE_PATH_HEADER = 'x-panel-page';

/** Параметр адреса входа, в котором едет путь возврата. */
export const RETURN_TO_PARAM = 'next';

/** Условный хост: против него разбирается путь, и уйти с него значит уйти к чужим. */
const OWN_ORIGIN = 'http://panel.invalid';

/**
 * Путь возврата — или `null`, если возвращаться туда нельзя или незачем.
 *
 * Проверяется и написание, и то, как адрес прочтёт браузер: разбор
 * убирает табуляцию и перевод строки, читает обратную косую как прямую
 * и сворачивает «/..//evil» в «//evil» — каждое из этого по первым знакам
 * выглядит своим путём, а открывает чужой хост. Возвращается разобранный
 * путь, а не присланная строка: браузер получит ровно то, что проверено.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;

  let url: URL;
  try {
    url = new URL(value, OWN_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== OWN_ORIGIN) return null;

  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  // На вход после входа и в маршрут API — не туда, куда шёл человек.
  if (url.pathname === '/login' || url.pathname.startsWith('/api/')) return null;
  return path;
}

/** Адрес входа: с путём возврата, если он есть и он свой, иначе просто вход. */
export function loginPath(returnTo: string | null | undefined): string {
  const path = safeReturnPath(returnTo);
  if (path === null || path === '/') return '/login';
  return `/login?${new URLSearchParams({ [RETURN_TO_PARAM]: path }).toString()}`;
}
