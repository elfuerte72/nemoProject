import { getInitData } from '@/lib/telegram/webapp';

/**
 * Запросы к собственному серверу из браузера Mini App.
 *
 * Данные запуска едут в каждом запросе: сессии как таковой нет, и это
 * сознательно. Telegram обновляет подпись при каждом открытии
 * приложения, поэтому отдельная кука дала бы второй, менее надёжный
 * способ узнать клиента.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const initData = getInitData();
  if (!initData) {
    throw new ApiError(401, 'Откройте приложение из Telegram');
  }

  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `tma ${initData}`,
      ...init.headers,
    },
  });

  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
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
