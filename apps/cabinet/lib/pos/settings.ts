/**
 * Настройка POS-терминала мерчанта: своя наценка.
 *
 * Наценка — про то, почём торгует мерчант, а не сервис: наценка
 * сервиса лежит в его настройках и в котировку уже входит, а эта —
 * поверх неё, доход самого мерчанта. Хранится, как и счета, в памяти
 * процесса (`mock/store.ts`); переедет в базу вместе с ними. Задаётся
 * в разделе «Настройки» кабинета, а не над терминалом: 22 сентября
 * 2026 владелец попросил «наценку добавить в общую конфигурацию» —
 * настройку правят раз в месяц, и держать её на экране кассы значило
 * показывать сотруднику ручку, которую ему крутить нельзя.
 *
 * Состава валют здесь больше нет: до 22 сентября владелец мог прятать
 * валюты с плиток у сотрудников, и по его слову («удалить валюты 8 из
 * 8») терминал торгует всем, что сервис выдаёт за рубли.
 *
 * Ставка — в целых базисных пунктах, как все ставки сервиса: на дробях
 * деньги уплывают. Задаётся при этом в процентах, потому что базисный
 * пункт понятен на бирже, а не у стойки.
 */

export interface PosSettings {
  /** Наценка мерчанта поверх курса сервиса, в базисных пунктах. */
  readonly markupBps: number;
}

export const DEFAULT_POS_SETTINGS: PosSettings = { markupBps: 0 };

/** До ста процентов, как у образца: наценка вдвое от цены — уже не наценка. */
export const MAX_MARKUP_BPS = 10_000;

export const POS_SETTINGS_COMPLAINTS = {
  markupNumber: 'Наценка — число процентов: например, 2 или 2,5',
  markupRange: 'Наценка — от 0 до 100 процентов',
  markupStep: 'Наценка задаётся с точностью до сотой процента',
} as const;

/**
 * Проценты из поля — в базисные пункты. Запятая и точка равноправны:
 * на русской клавиатуре первой стоит запятая.
 */
export function parseMarkupPercent(
  text: string,
): { readonly ok: true; readonly bps: number } | { readonly ok: false; readonly complaint: string } {
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,4})?$/u.test(cleaned)) {
    return { ok: false, complaint: POS_SETTINGS_COMPLAINTS.markupNumber };
  }
  const [whole, fraction = ''] = cleaned.split('.');
  if (fraction.length > 2) return { ok: false, complaint: POS_SETTINGS_COMPLAINTS.markupStep };
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (bps > MAX_MARKUP_BPS) return { ok: false, complaint: POS_SETTINGS_COMPLAINTS.markupRange };
  return { ok: true, bps };
}

/** Базисные пункты — в проценты для поля: «250» → «2,5», «0» → «0». */
export function markupPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return String(whole);
  return `${whole},${String(fraction).padStart(2, '0').replace(/0$/u, '')}`;
}
