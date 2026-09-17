/**
 * Ключ повтора рассылки: какой ключ уходит с отправкой.
 *
 * Рассылка идёт минутами, а запрос, который её запустил, рвётся по
 * таймауту раньше; повтор с тем же ключом ядро узнаёт и второй раз не
 * рассылает. Ключ принадлежит тексту, который уже пытались отправить, а
 * не состоянию поля: правка «дописал и стёр» не делает черновик новым.
 * Попытка хранится во вкладке (`sessionStorage`), потому что после
 * оборванного запроса страницу обновляют — посмотреть, ушло ли, — и
 * вставляют тот же текст заново.
 */

export interface BroadcastAttempt {
  /** Текст без пробелов по краям — так его сравнивает и ядро. */
  readonly body: string;
  readonly key: string;
}

/** Ключ в хранилище вкладки. Личное: коллег и другие вкладки не касается. */
export const BROADCAST_ATTEMPT_KEY = 'nemo.admin.broadcast.attempt';

/** Попытка для этого текста: прежняя, если текст тот же, иначе новая. */
export function attemptFor(
  body: string,
  last: BroadcastAttempt | undefined,
  makeKey: () => string,
): BroadcastAttempt {
  const text = body.trim();
  return last !== undefined && last.body === text ? last : { body: text, key: makeKey() };
}

/** Сохранённая попытка. Испорченная или чужой формы — как не было. */
export function parseStoredAttempt(raw: string | null): BroadcastAttempt | undefined {
  if (raw === null) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const { body, key } = value as Record<string, unknown>;
    return typeof body === 'string' && typeof key === 'string' && key.length > 0
      ? { body, key }
      : undefined;
  } catch {
    return undefined;
  }
}
