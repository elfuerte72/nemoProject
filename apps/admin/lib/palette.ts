/**
 * Что набрали в палитре быстрого перехода.
 *
 * Три вида ввода различаются формой, а не словами: полный UUID — это
 * заявка, и её открывают сразу; целое число — Telegram ID клиента, и
 * ведёт оно в переписку; всё остальное — поиск по нику или части
 * номера в открытых заявках. Разбор чистый, чтобы его можно было
 * проверить без браузера.
 */

export type PaletteQuery =
  | { readonly kind: 'empty' }
  | { readonly kind: 'short' }
  | { readonly kind: 'request'; readonly id: string }
  | { readonly kind: 'client'; readonly id: string }
  | { readonly kind: 'search'; readonly query: string };

/** Меньше двух знаков — не поиск: по одной букве найдётся вся очередь. */
export const MIN_QUERY_LENGTH = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function classifyQuery(raw: string): PaletteQuery {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  if (UUID.test(text)) return { kind: 'request', id: text.toLowerCase() };
  if (/^\d+$/.test(text)) return { kind: 'client', id: text };
  // Ник могут набрать с собакой — в базе он без неё.
  const query = text.replace(/^@/, '');
  if (query.length < MIN_QUERY_LENGTH) return { kind: 'short' };
  return { kind: 'search', query };
}

/** Куда ведёт прямой переход. Поиск сюда не попадает — у него список. */
export function directHref(query: PaletteQuery): string | null {
  switch (query.kind) {
    case 'request':
      return `/exchange-requests/${query.id}`;
    case 'client':
      return `/clients/${query.id}`;
    default:
      return null;
  }
}
