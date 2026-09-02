import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  gridColumns,
  readTablePrefs,
  serializeTablePrefs,
  toggleHidden,
} from './table-prefs';

/**
 * Настройки таблицы стола — личные и живут в куке, которую никто не
 * охраняет. Стол обязан открыться при любом её содержимом, а чужая
 * запись читаться как отсутствующая.
 */
describe('настройки таблицы стола', () => {
  it('переживают запись и чтение своим сотрудником', () => {
    const prefs = { hidden: ['kind' as const], dense: true, pageSize: 100 as const };
    expect(readTablePrefs(serializeTablePrefs(prefs, 'petr'), 'petr')).toEqual(prefs);
  });

  it('чужая запись читается как отсутствующая', () => {
    const raw = serializeTablePrefs({ hidden: ['client'], dense: true, pageSize: 25 }, 'petr');
    expect(readTablePrefs(raw, 'anna')).toEqual(DEFAULT_PREFS);
  });

  it('испорченная запись не роняет стол', () => {
    expect(readTablePrefs('{oops', 'petr')).toEqual(DEFAULT_PREFS);
    expect(readTablePrefs(null, 'petr')).toEqual(DEFAULT_PREFS);
    expect(
      readTablePrefs(
        encodeURIComponent(JSON.stringify({ staffId: 'petr', hidden: ['nope', 'kind'], pageSize: 7 })),
        'petr',
      ),
    ).toEqual({ hidden: ['kind'], dense: false, pageSize: 50 });
  });

  it('переключение колонки — туда и обратно', () => {
    const once = toggleHidden(DEFAULT_PREFS, 'client');
    expect(once.hidden).toEqual(['client']);
    expect(toggleHidden(once, 'client').hidden).toEqual([]);
  });

  /*
   * Выключенная колонка уходит из сетки, а не прячется: иначе на её
   * месте оставалась бы пустота шириной в столбец.
   */
  it('сетка собирается из видимых колонок', () => {
    expect(gridColumns(DEFAULT_PREFS, true)).toBe(
      'minmax(0, 1fr) 170px minmax(0, 1fr) 140px 110px 120px',
    );
    expect(gridColumns({ ...DEFAULT_PREFS, hidden: ['kind', 'submitted'] }, false)).toBe(
      'minmax(0, 1fr) minmax(0, 1fr) 140px',
    );
  });
});
