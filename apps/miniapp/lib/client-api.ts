import { getInitData } from '@/lib/telegram/webapp';

/**
 * Запросы к собственному серверу из браузера Mini App.
 *
 * Данные запуска едут в каждом запросе: сессии как таковой нет, и это
 * сознательно. Telegram обновляет подпись при каждом открытии
 * приложения, поэтому отдельная кука дала бы второй, менее надёжный
 * способ узнать клиента.
 */

/**
 * Сколько ждать ответа.
 *
 * У запроса без срока его нет вовсе: молчащая сеть — обычное дело в
 * метро и роуминге, и там приложение висело бы с крутящимся ожиданием до
 * закрытия. Пятнадцать секунд: дольше человек и так не ждёт, а короче
 * рвало бы честно медленные ответы на плохой связи.
 */
const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Что сказать, когда сервер перестал узнавать запуск.
 *
 * Подпись, которой Telegram отмечает запуск, живёт сутки, а приложение
 * висит открытым дольше: свёрнутое, оно живёт в памяти неделями. Тогда
 * отказом отвечает каждый запрос, и чинит это только сам человек —
 * переоткрыв приложение. Сервер причину не называет намеренно — по ней
 * подбирали бы подпись, — поэтому текст ставится здесь, на единственной
 * дороге всех запросов, а не в каждом экране по-своему.
 *
 * «Если не помогло» — не вежливость: тем же отказом оборачивается и
 * подпись чужого бота, и слетевший на сервере токен, и там переоткрытие
 * не помогает, сколько ни повторяй. Совет без выхода водил бы по кругу.
 */
export const SESSION_STALE_MESSAGE =
  'Сессия устарела. Закройте приложение и откройте его заново, а если не помогло — напишите нам в чате бота.';

/**
 * Срок для запроса. Отсутствие поддержки — рабочий случай: в старом
 * webview запрос остаётся бессрочным, то есть ведёт себя как раньше.
 */
function deadline(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const initData = getInitData();
  if (!initData) {
    throw new ApiError(401, 'Откройте приложение из Telegram');
  }

  const signal = deadline();
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      ...(signal ? { signal } : {}),
      headers: {
        'content-type': 'application/json',
        authorization: `tma ${initData}`,
        ...init.headers,
      },
    });
  } catch (failure) {
    /*
     * Сеть не ответила — это не то же самое, что отказ сервера, и
     * сказать об этом надо иначе: сервер жив, а связь пропала, и
     * помогает здесь не обращение к менеджеру, а повторная попытка.
     *
     * Ноль вместо кода: кода нет, потому что ответа не было.
     */
    throw new ApiError(
      0,
      failure instanceof DOMException && failure.name === 'TimeoutError'
        ? 'Сервис не ответил вовремя. Проверьте связь и попробуйте снова.'
        : 'Нет связи с сервисом. Проверьте интернет и попробуйте снова.',
    );
  }

  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Отказ в узнавании — один на все маршруты, и текст у него один:
    // серверное «не удалось подтвердить запуск» не говорит человеку,
    // что делать, а делать всегда одно и то же.
    if (response.status === 401) {
      throw new ApiError(401, SESSION_STALE_MESSAGE);
    }
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : 'Не удалось выполнить запрос';
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
