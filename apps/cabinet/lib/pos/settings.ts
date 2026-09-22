/**
 * Настройки POS-терминала мерчанта: своя наценка и какие валюты видят
 * сотрудники.
 *
 * Обе — у образца, и обе про то, чем и почём торгует мерчант, а не
 * сервис: наценка сервиса лежит в его настройках и в котировку уже
 * входит, а эта — поверх неё, доход самого мерчанта. Хранятся, как и
 * счета, в памяти процесса (`mock/store.ts`); переедут в базу вместе с
 * ними.
 *
 * Ставка — в целых базисных пунктах, как все ставки сервиса: на дробях
 * деньги уплывают. Задаётся при этом в процентах, потому что базисный
 * пункт понятен на бирже, а не у стойки.
 */

export interface PosSettings {
  /** Наценка мерчанта поверх курса сервиса, в базисных пунктах. */
  readonly markupBps: number;
  /** Валюты, которых сотрудники в терминале не видят. */
  readonly hiddenCodes: readonly string[];
}

export const DEFAULT_POS_SETTINGS: PosSettings = { markupBps: 0, hiddenCodes: [] };

/** До ста процентов, как у образца: наценка вдвое от цены — уже не наценка. */
export const MAX_MARKUP_BPS = 10_000;

export const POS_SETTINGS_COMPLAINTS = {
  markupNumber: 'Наценка — число процентов: например, 2 или 2,5',
  markupRange: 'Наценка — от 0 до 100 процентов',
  markupStep: 'Наценка задаётся с точностью до сотой процента',
  allHidden: 'Скрыть все валюты нельзя: терминалу нечем будет торговать',
  unknownCode: 'Такой валюты в терминале нет',
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

/**
 * Что из направлений сотрудник видит. Скрытое — не удалённое: курс у
 * направления есть, а мерчант решил не торговать им у стойки.
 */
export function visibleDirections<T extends { readonly toCode: string }>(
  directions: readonly T[],
  settings: PosSettings,
): readonly T[] {
  const hidden = new Set(settings.hiddenCodes);
  return directions.filter((one) => !hidden.has(one.toCode));
}

/**
 * Проверка набора скрытых валют против того, чем терминал торгует:
 * незнакомый код — опечатка или чужой список, а скрытые все — терминал
 * без товара.
 */
export function checkHiddenCodes(
  hidden: readonly string[],
  available: readonly string[],
): string | null {
  const known = new Set(available);
  if (hidden.some((code) => !known.has(code))) return POS_SETTINGS_COMPLAINTS.unknownCode;
  if (available.length > 0 && available.every((code) => hidden.includes(code))) {
    return POS_SETTINGS_COMPLAINTS.allHidden;
  }
  return null;
}
