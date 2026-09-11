import type { MerchantBreakdowns, MerchantRecipientSlice, MerchantSlice } from '@nemo/core';
import { describeRequisites } from '@nemo/types';
import { formatByCurrency } from '@nemo/ui/money-list';
import { formatShare } from '@nemo/ui/format';
import {
  BY_KEY,
  PAYOUT_METHOD_LABELS,
  SOURCE_LABELS,
  STEP_LABELS,
  UNKNOWN_METHOD,
  UNKNOWN_RECIPIENT,
  UNKNOWN_SOURCE,
  WEEKDAY_LABELS,
} from './analytics-texts';

/**
 * Разрезы таблицами: шапка, строки и выгрузка — из одного места.
 *
 * Экран и файл берут отсюда и колонки, и ячейки: два набора колонок
 * разошлись бы при первой правке, а заметил бы это тот, кто сверяет
 * выгрузку с экраном — то есть уже после того, как поверил числу.
 *
 * Пустой разрез сюда не попадает: таблица с одной строкой «нет данных»
 * занимает экран ровно столько же, сколько таблица с числами, и
 * читается как сломанная.
 */

export type AnalyticsTableKey =
  | 'direction'
  | 'method'
  | 'recipient'
  | 'source'
  | 'staff'
  | 'series'
  | 'hour'
  | 'weekday';

export type Cell = string | number;

export interface AnalyticsTable {
  readonly key: AnalyticsTableKey;
  readonly title: string;
  readonly note: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
}

/** Четыре числа разреза, одни у всех таблиц: подано, исполнено, отменено, оборот. */
const SLICE_COLUMNS = ['Подано', 'Исполнено', 'Отменено', 'Конверсия', 'Оборот'] as const;

function sliceCells(slice: MerchantSlice): Cell[] {
  return [
    slice.submitted,
    slice.completed,
    slice.cancelled,
    /*
     * Конверсия строки — доля дошедших среди поданных в неё, числом из
     * самого разреза. Делить «исполнено» на «подано» нельзя: они
     * посчитаны по разным датам, и в неделю, когда разгребают хвост,
     * дробь переваливает за сотню процентов. Без поданных конверсии
     * нет — ноль означал бы «не дошёл никто».
     */
    formatShare(slice.submitted === 0 ? null : slice.converted / slice.submitted),
    formatByCurrency(slice.turnover),
  ];
}

/**
 * Как назвать получателя в строке.
 *
 * К описанию записи добавляется имя держателя, если оно есть: у
 * тайского счёта `describeRequisites` его не показывает, а два счёта в
 * одном банке с одинаковым хвостом номера иначе неразличимы — строки
 * выглядят одинаково, и мерчант не поймёт, чьи они.
 */
function recipientLabel(one: MerchantRecipientSlice): string {
  if (one.kind === null) return UNKNOWN_RECIPIENT;
  const described = describeRequisites({ ...one, kind: one.kind });
  return one.holderName ? `${described} · ${one.holderName}` : described;
}

export function analyticsTables(cut: MerchantBreakdowns): readonly AnalyticsTable[] {
  const tables: AnalyticsTable[] = [];

  if (cut.byDirection.length > 0) {
    tables.push({
      key: 'direction',
      title: 'По направлениям',
      note: 'Что на что меняли и сколько прошло каждой парой',
      columns: ['Направление', ...SLICE_COLUMNS],
      rows: cut.byDirection.map((one) => [
        `${one.fromCode} → ${one.toCode}`,
        ...sliceCells(one),
      ]),
    });
  }

  if (cut.byPayoutMethod.length > 0) {
    tables.push({
      key: 'method',
      title: 'По способам выдачи',
      note: 'Куда уходили деньги: на банк, на кошелёк или наличными',
      columns: ['Способ', ...SLICE_COLUMNS],
      rows: cut.byPayoutMethod.map((one) => [
        one.method === null ? UNKNOWN_METHOD : PAYOUT_METHOD_LABELS[one.method],
        ...sliceCells(one),
      ]),
    });
  }

  if (cut.byRecipient.length > 0) {
    tables.push({
      key: 'recipient',
      title: 'По получателям',
      note:
        cut.recipientsHidden > 0
          ? `Строка — человек, а не запись. Показаны самые частые; ещё ${cut.recipientsHidden} не поместились`
          : 'Строка — человек, а не запись: по API она заводится на каждую заявку заново',
      columns: ['Получатель', ...SLICE_COLUMNS],
      rows: cut.byRecipient.map((one) => [recipientLabel(one), ...sliceCells(one)]),
    });
  }

  if (cut.bySource.length > 0) {
    tables.push({
      key: 'source',
      title: 'По источникам',
      note: 'Сколько прошло через интеграцию, а сколько завели руками',
      columns: ['Источник', ...SLICE_COLUMNS],
      rows: cut.bySource.map((one) => [
        one.source === null ? UNKNOWN_SOURCE : SOURCE_LABELS[one.source],
        ...sliceCells(one),
      ]),
    });
  }

  if (cut.byStaff.length > 0) {
    tables.push({
      key: 'staff',
      title: 'По сотрудникам',
      note: 'Кто подал: заявки по ключу API ничьи — ключ принадлежит кабинету',
      columns: ['Сотрудник', ...SLICE_COLUMNS],
      rows: cut.byStaff.map((one) => [one.name ?? BY_KEY, ...sliceCells(one)]),
    });
  }

  if (cut.series.length > 0) {
    tables.push({
      key: 'series',
      title: STEP_LABELS[cut.step],
      note: 'Подано и отменено по своим датам, оборот — по исполнению',
      columns: ['Начало', 'Подано', 'Исполнено', 'Отменено', 'Оборот'],
      rows: cut.series.map((one) => [
        one.at,
        one.submitted,
        one.completed,
        one.cancelled,
        formatByCurrency(one.turnover),
      ]),
    });
  }

  const hours = cut.byHour.reduce((total, one) => total + one.submitted, 0);
  if (hours > 0) {
    tables.push({
      key: 'hour',
      title: 'По часам',
      note: 'Когда подают заявки — по часам вашего браузера',
      columns: ['Час', 'Подано'],
      // Все двадцать четыре, включая пустые: провал в ряду — это ответ
      // на вопрос «когда нас не беспокоят», а не пропуск.
      rows: cut.byHour.map((one) => [`${String(one.hour).padStart(2, '0')}:00`, one.submitted]),
    });
    tables.push({
      key: 'weekday',
      title: 'По дням недели',
      note: 'Понедельник первым',
      columns: ['День', 'Подано'],
      rows: cut.byWeekday.map((one) => [
        WEEKDAY_LABELS[one.weekday - 1] ?? String(one.weekday),
        one.submitted,
      ]),
    });
  }

  return tables;
}
