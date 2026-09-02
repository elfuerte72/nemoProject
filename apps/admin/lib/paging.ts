/**
 * Дочитывание очереди по курсору.
 *
 * Курсор — пара «время подачи и идентификатор» последней показанной
 * строки: одно время теряет или дублирует заявки, поданные в одну
 * миллисекунду (то же правило, что у выборки ядра). Страницы
 * склеиваются без дублей: между двумя дочитываниями тихое обновление
 * перечитывает первую страницу, и строка, уехавшая из неё вниз, иначе
 * появилась бы дважды.
 */

export interface Cursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface PagedRow {
  readonly id: string;
  /** ISO-строка: `Date` в клиентский компонент не переезжает. */
  readonly createdAt: string;
}

export function cursorOf(rows: readonly PagedRow[]): Cursor | null {
  const last = rows[rows.length - 1];
  return last ? { createdAt: last.createdAt, id: last.id } : null;
}

export function mergePages<T extends PagedRow>(shown: readonly T[], next: readonly T[]): T[] {
  const seen = new Set(shown.map((row) => row.id));
  return [...shown, ...next.filter((row) => !seen.has(row.id))];
}

/** Курсор в параметры адреса и обратно. Испорченный — как отсутствующий. */
export function cursorToParams(cursor: Cursor): Record<string, string> {
  return { after: cursor.createdAt, afterId: cursor.id };
}

export function cursorFromParams(params: URLSearchParams): Cursor | null {
  const createdAt = params.get('after');
  const id = params.get('afterId');
  if (!createdAt || !id) return null;
  if (Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}
