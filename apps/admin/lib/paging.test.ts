import { describe, expect, it } from 'vitest';
import { cursorFromParams, cursorOf, cursorToParams, mergePages } from './paging';

const row = (id: string, createdAt = '2026-09-02T10:00:00.000Z') => ({ id, createdAt });

describe('дочитывание по курсору', () => {
  it('курсор — последняя показанная строка', () => {
    expect(cursorOf([row('a'), row('b', '2026-09-02T11:00:00.000Z')])).toEqual({
      id: 'b',
      createdAt: '2026-09-02T11:00:00.000Z',
    });
    expect(cursorOf([])).toBeNull();
  });

  /*
   * Между дочитываниями первая страница перечитывается, и строка,
   * уехавшая из неё вниз, приходит второй страницей ещё раз.
   */
  it('страницы склеиваются без дублей и в порядке прихода', () => {
    const merged = mergePages([row('a'), row('b')], [row('b'), row('c')]);
    expect(merged.map((one) => one.id)).toEqual(['a', 'b', 'c']);
  });

  it('курсор переживает адрес, испорченный читается как отсутствующий', () => {
    const cursor = { createdAt: '2026-09-02T10:00:00.000Z', id: 'x' };
    const params = new URLSearchParams(cursorToParams(cursor));
    expect(cursorFromParams(params)).toEqual(cursor);
    expect(cursorFromParams(new URLSearchParams({ after: 'вчера', afterId: 'x' }))).toBeNull();
    expect(cursorFromParams(new URLSearchParams({ after: cursor.createdAt }))).toBeNull();
  });
});
