/**
 * Личные настройки таблицы стола: какие колонки показывать, плотность,
 * строк на странице.
 *
 * Живут в куке, а не в `localStorage`: строк на странице — это предел
 * выборки, а выборку делает сервер, и знать число он должен до
 * отрисовки. Кука не `httpOnly` — её пишет сама страница. Внутри —
 * идентификатор сотрудника: два человека на одном ноутбуке не должны
 * видеть настроек друг друга, и чужая запись читается как отсутствующая.
 *
 * Обмен и состояние выключить нельзя: без них строка не отвечает на
 * вопрос, ради которого стол открыт.
 */

export const TABLE_PREFS_COOKIE = 'nemo_desk_table';

export const optionalColumns = ['kind', 'client', 'manager', 'submitted'] as const;
export type OptionalColumn = (typeof optionalColumns)[number];

export const COLUMN_LABELS: Record<OptionalColumn, string> = {
  kind: 'Вид',
  client: 'Клиент',
  manager: 'Ведёт',
  submitted: 'Подана',
};

export const pageSizes = [25, 50, 100] as const;
export type PageSize = (typeof pageSizes)[number];

export interface TablePrefs {
  readonly hidden: readonly OptionalColumn[];
  readonly dense: boolean;
  readonly pageSize: PageSize;
}

export const DEFAULT_PREFS: TablePrefs = { hidden: [], dense: false, pageSize: 50 };

/**
 * Настройки из строки куки для этого сотрудника. Чужая, испорченная и
 * отсутствующая запись — значения по умолчанию: меню и стол обязаны
 * открыться при любом содержимом куки.
 */
export function readTablePrefs(raw: string | null | undefined, staffId: string): TablePrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFS;
    const record = parsed as Record<string, unknown>;
    if (record.staffId !== staffId) return DEFAULT_PREFS;
    const hidden = Array.isArray(record.hidden)
      ? record.hidden.filter((one): one is OptionalColumn =>
          (optionalColumns as readonly string[]).includes(String(one)),
        )
      : [];
    const pageSize = (pageSizes as readonly number[]).includes(Number(record.pageSize))
      ? (Number(record.pageSize) as PageSize)
      : DEFAULT_PREFS.pageSize;
    return { hidden, dense: record.dense === true, pageSize };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function serializeTablePrefs(prefs: TablePrefs, staffId: string): string {
  return encodeURIComponent(JSON.stringify({ staffId, ...prefs }));
}

export function toggleHidden(prefs: TablePrefs, column: OptionalColumn): TablePrefs {
  const hidden = prefs.hidden.includes(column)
    ? prefs.hidden.filter((one) => one !== column)
    : [...prefs.hidden, column];
  return { ...prefs, hidden };
}

/**
 * Сетка колонок под видимый набор. Ширины те же, что были у полного
 * набора: выключенная колонка убирается из сетки, а не прячется —
 * иначе на её месте оставалась бы пустота.
 */
export function gridColumns(prefs: TablePrefs, showManager: boolean): string {
  const shown = (column: OptionalColumn) => !prefs.hidden.includes(column);
  const parts = ['minmax(0, 1fr)'];
  if (shown('kind')) parts.push('170px');
  if (shown('client')) parts.push('minmax(0, 1fr)');
  parts.push('140px');
  if (showManager && shown('manager')) parts.push('110px');
  if (shown('submitted')) parts.push('120px');
  return parts.join(' ');
}
