import type {
  MerchantBreakdowns,
  MerchantPeriodSummary,
  MerchantRecipientSlice,
  MerchantSlice,
} from '@nemo/core';
import { describeRequisites, exchangeRequestStatuses, merchantRoleName } from '@nemo/types';
import { averageByCurrency, formatByCurrency } from '@nemo/ui/money-list';
import { formatAmount, formatMinutes, formatShare } from '@nemo/ui/format';
import { dayOf } from '@nemo/ui/period';
import {
  BY_KEY,
  OUTCOME_LABELS,
  PAYOUT_METHOD_LABELS,
  SOURCE_LABELS,
  UNKNOWN_METHOD,
  UNKNOWN_RECIPIENT,
  UNKNOWN_SOURCE,
  WEEKDAY_LABELS,
} from './analytics-texts';
import { formatPerDay, monthEstimate, outcomeRows, perDay, shareOf } from './analytics-view';
import { STATUS_LABELS } from './labels';

/**
 * Разрезы таблицами: шапка, строки и выгрузка — из одного места.
 *
 * Экран и файл берут отсюда и колонки, и ячейки: два набора колонок
 * разошлись бы при первой правке, а заметил бы это тот, кто сверяет
 * выгрузку с экраном — то есть уже после того, как поверил числу.
 * Порядок таблиц — порядок блоков на странице, и тем же порядком они
 * идут в отчёте целиком («Выгрузить отчёт»).
 *
 * Пустой разрез сюда не попадает: таблица с одной строкой «нет данных»
 * занимает экран ровно столько же, сколько таблица с числами, и
 * читается как сломанная.
 */

export type AnalyticsTableKey =
  | 'summary'
  | 'series'
  | 'outcome'
  | 'status'
  | 'hour'
  | 'weekday'
  | 'load'
  | 'staff'
  | 'recipient'
  | 'currency'
  | 'direction'
  | 'method'
  | 'source';

export type Cell = string | number;

export interface AnalyticsTable {
  readonly key: AnalyticsTableKey;
  readonly title: string;
  readonly note: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
  /**
   * Коды валют для значков перед первой ячейкой строки: у валюты один,
   * у направления два. Только экрану — в файле значка нет, код и так
   * стоит в ячейке.
   */
  readonly marks?: readonly (readonly string[])[];
}

/** Четыре числа разреза, одни у всех таблиц: подано, исполнено, отменено, оборот. */
const SLICE_COLUMNS = ['Подано', 'Исполнено', 'Отменено', 'Конверсия', 'Оборот'] as const;

function conversionOf(slice: MerchantSlice): string {
  /*
   * Конверсия строки — доля дошедших среди поданных в неё, числом из
   * самого разреза. Делить «исполнено» на «подано» нельзя: они
   * посчитаны по разным датам, и в неделю, когда разгребают хвост,
   * дробь переваливает за сотню процентов. Без поданных конверсии
   * нет — ноль означал бы «не дошёл никто».
   */
  return formatShare(slice.submitted === 0 ? null : slice.converted / slice.submitted);
}

function sliceCells(slice: MerchantSlice): Cell[] {
  return [
    slice.submitted,
    slice.completed,
    slice.cancelled,
    conversionOf(slice),
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

/** Час двумя знаками — «09:00»: в столбце они стоят ровно. */
function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function analyticsTables(
  cut: MerchantBreakdowns,
  options: { readonly offsetMinutes?: number } = {},
): readonly AnalyticsTable[] {
  const offset = options.offsetMinutes ?? 0;
  const tables: AnalyticsTable[] = [];
  const submitted = cut.funnel.stages.reduce((total, one) => total + one.count, 0);

  if (cut.series.length > 0) {
    tables.push({
      key: 'series',
      title: 'Динамика',
      note: 'Каждое число по своей дате: подано по подаче, исполнено и оборот по исполнению, отменено по отмене',
      columns: ['Начало', 'Подано', 'Исполнено', 'Отменено', 'Получатели', 'Оборот'],
      rows: cut.series.map((one) => [
        one.at,
        one.submitted,
        one.completed,
        one.cancelled,
        one.recipients,
        formatByCurrency(one.turnover),
      ]),
    });
  }

  if (submitted > 0) {
    tables.push({
      key: 'outcome',
      title: 'Воронка заявок',
      note: 'Куда ушли поданные в период — по состоянию сейчас',
      columns: ['Исход', 'Заявок', 'Доля от поданных'],
      rows: outcomeRows(cut.funnel).map((one) => [
        OUTCOME_LABELS[one.key],
        one.count,
        formatShare(shareOf(one.count, submitted)),
      ]),
    });
    tables.push({
      key: 'status',
      title: 'Состояния',
      note: 'Поданные в период — в каком состоянии они сейчас',
      columns: ['Состояние', 'Заявок', 'Доля'],
      // Все состояния, и пустые тоже: пропавшая строка читалась бы как
      // «такого не бывает», а не «сейчас таких нет».
      rows: exchangeRequestStatuses.map((status) => {
        const count = cut.funnel.stages.find((one) => one.status === status)?.count ?? 0;
        return [STATUS_LABELS[status], count, formatShare(shareOf(count, submitted))];
      }),
    });
  }

  const hours = cut.byHour.reduce((total, one) => total + one.submitted, 0);
  if (hours > 0) {
    tables.push({
      key: 'hour',
      title: 'Часы подачи',
      note: 'Когда подают заявки — по часам вашего браузера',
      columns: ['Час', 'Подано'],
      // Все двадцать четыре, включая пустые: провал в ряду — это ответ
      // на вопрос «когда нас не беспокоят», а не пропуск.
      rows: cut.byHour.map((one) => [hourLabel(one.hour), one.submitted]),
    });
    tables.push({
      key: 'weekday',
      title: 'Дни недели',
      note: 'Понедельник первым',
      columns: ['День', 'Подано'],
      rows: cut.byWeekday.map((one) => [
        WEEKDAY_LABELS[one.weekday - 1] ?? String(one.weekday),
        one.submitted,
      ]),
    });
    tables.push({
      key: 'load',
      title: 'Карта нагрузки',
      note: 'Подано по дням недели и часам',
      columns: ['День', ...Array.from({ length: 24 }, (_, hour) => hourLabel(hour))],
      rows: cut.load.map((line, index) => [WEEKDAY_LABELS[index] ?? String(index + 1), ...line]),
    });
  }

  if (cut.byStaff.length > 0) {
    tables.push({
      key: 'staff',
      title: 'Сотрудники',
      note: 'Кто подал: заявки по ключу API ничьи — ключ принадлежит кабинету',
      columns: [
        'Сотрудник',
        'Роль',
        'Подано',
        'Исполнено',
        'Отменено',
        'Конверсия',
        'Средний чек',
        'Оборот',
      ],
      rows: cut.byStaff.map((one) => [
        one.name ?? BY_KEY,
        one.role === null ? '—' : merchantRoleName(one.role),
        one.submitted,
        one.completed,
        one.cancelled,
        conversionOf(one),
        formatByCurrency(averageByCurrency(one.turnover)),
        formatByCurrency(one.turnover),
      ]),
    });
  }

  if (cut.byRecipient.length > 0) {
    /*
     * Счётчик над таблицей считает получателей с поданными в период, а
     * в таблице стоят и те, чью давнюю заявку в период исполнили или
     * отменили: у них «Подано 0». Без пояснения два числа одной карточки
     * читались бы как два разных ответа.
     */
    const closedOnly = cut.byRecipient.filter((one) => one.kind !== null && one.submitted === 0).length;
    const base =
      cut.recipientsHidden > 0
        ? `Строка — человек, а не запись. Показаны самые частые; ещё ${cut.recipientsHidden} не поместились`
        : 'Строка — человек, а не запись: по API она заводится на каждую заявку заново';
    tables.push({
      key: 'recipient',
      title: 'Получатели',
      note:
        closedOnly > 0
          ? `${base}. С «Подано 0» — те, чью заявку подали раньше, а закрыли в этот период`
          : base,
      columns: ['Получатель', 'Впервые', 'Последняя заявка', ...SLICE_COLUMNS],
      rows: cut.byRecipient.map((one) => [
        recipientLabel(one),
        // «Впервые» — только у названного получателя: про заявку без
        // записи сказать, новый ли он, нечем.
        one.kind !== null && one.fresh ? 'да' : '',
        one.lastSubmittedAt === null ? '—' : dayOf(one.lastSubmittedAt, offset),
        ...sliceCells(one),
      ]),
    });
  }

  if (cut.byCurrency.length > 0) {
    tables.push({
      key: 'currency',
      title: 'Валюты',
      note: 'Отдано вами и получено получателями — по исполненным в период',
      columns: ['Валюта', 'Отдано', 'Получено', 'Заявок'],
      rows: cut.byCurrency.map((one) => [
        one.code,
        one.given ? `${formatAmount(one.given.amount)} ${one.code}` : '—',
        one.received ? `${formatAmount(one.received.amount)} ${one.code}` : '—',
        // Заявка в одной валюте либо отдаёт, либо получает — обе
        // стороны одной сделки в одну валюту не попадают, и сумма
        // счётчиков не считает её дважды.
        (one.given?.count ?? 0) + (one.received?.count ?? 0),
      ]),
      marks: cut.byCurrency.map((one) => [one.code]),
    });
  }

  if (cut.byDirection.length > 0) {
    tables.push({
      key: 'direction',
      title: 'Направления',
      note: 'Что на что меняли и сколько прошло каждой парой',
      columns: ['Направление', ...SLICE_COLUMNS],
      rows: cut.byDirection.map((one) => [
        `${one.fromCode} → ${one.toCode}`,
        ...sliceCells(one),
      ]),
      marks: cut.byDirection.map((one) => [one.fromCode, one.toCode]),
    });
  }

  if (cut.byPayoutMethod.length > 0) {
    tables.push({
      key: 'method',
      title: 'Способы выдачи',
      note: 'Куда уходили деньги: на банк, на кошелёк или наличными',
      columns: ['Способ', ...SLICE_COLUMNS],
      rows: cut.byPayoutMethod.map((one) => [
        one.method === null ? UNKNOWN_METHOD : PAYOUT_METHOD_LABELS[one.method],
        ...sliceCells(one),
      ]),
    });
  }

  if (cut.bySource.length > 0) {
    tables.push({
      key: 'source',
      title: 'Источники',
      note: 'Сколько прошло через интеграцию, а сколько завели руками',
      columns: ['Источник', ...SLICE_COLUMNS],
      rows: cut.bySource.map((one) => [
        one.source === null ? UNKNOWN_SOURCE : SOURCE_LABELS[one.source],
        ...sliceCells(one),
      ]),
    });
  }

  return tables;
}

/** «66» или «66 (с ошибкой 22)» — как пояснение под плиткой, одной ячейкой. */
function withFailures(counts: { total: number; failed: number }, what: string): string {
  return counts.failed === 0 ? String(counts.total) : `${counts.total} (${what} ${counts.failed})`;
}

/**
 * Показатели одной таблицей: плитки, сроки, рекорды и прогноз — «сейчас»
 * и «было». Первым разделом отчёта: «отчёт целиком», в котором нет
 * оборота, — не отчёт. Прошлого периода у рекорда и медианы нет: их
 * сравнивать не с чем, и там прочерк, а не ноль.
 *
 * Вызовы API и доставки вебхуков — кабинета, а не человека, и в отборе
 * «только мои» их нет, как нет и плиток на экране.
 */
export function summaryTable(
  stats: { readonly current: MerchantPeriodSummary; readonly previous: MerchantPeriodSummary },
  cut: MerchantBreakdowns,
  options: {
    /** Сутки периода целиком — делитель темпа прошлого периода: он закончился. */
    readonly days: number;
    /** Прошедшие сутки текущего — его темп считается по ним (`elapsedDays`). */
    readonly paceDays: number;
    readonly mine: boolean;
  },
): AnalyticsTable {
  const { current, previous } = stats;
  const { days, paceDays } = options;
  const rows: Cell[][] = [
    ['Оборот', formatByCurrency(current.turnover), formatByCurrency(previous.turnover)],
    [
      'Средний чек',
      formatByCurrency(averageByCurrency(current.turnover)),
      formatByCurrency(averageByCurrency(previous.turnover)),
    ],
    ['Медиана чека', formatByCurrency(cut.medianTicket), '—'],
    ['Подано', current.submitted, previous.submitted],
    ['Исполнено', current.completed, previous.completed],
    ['Отменено', current.cancelled, previous.cancelled],
    ['В работе', current.open, previous.open],
    ['Конверсия', formatShare(current.conversion), formatShare(previous.conversion)],
    [
      'До исполнения, в среднем',
      formatMinutes(current.averageMinutesToComplete),
      formatMinutes(previous.averageMinutesToComplete),
    ],
    ['До исполнения, медиана', formatMinutes(cut.records.medianMinutes), '—'],
    [
      'Получателей',
      `${cut.recipients.total} (впервые ${cut.recipients.fresh}, вернулись ${cut.recipients.returning})`,
      '—',
    ],
  ];
  if (!options.mine) {
    rows.push(
      ['Вызовов API', withFailures(current.apiCalls, 'с ошибкой'), withFailures(previous.apiCalls, 'с ошибкой')],
      [
        'Доставок вебхуков',
        withFailures(current.webhookDeliveries, 'не доставлено'),
        withFailures(previous.webhookDeliveries, 'не доставлено'),
      ],
    );
  }
  rows.push(
    [
      'Лучший день',
      cut.records.bestDay ? `${cut.records.bestDay.at} · исполнено ${cut.records.bestDay.completed}` : '—',
      '—',
    ],
    ['Крупнейшая заявка', formatByCurrency(cut.records.largest), '—'],
    [
      'В среднем в день',
      formatByCurrency(perDay(current.turnover, paceDays)),
      formatByCurrency(perDay(previous.turnover, days)),
    ],
    ['Заявок в день', formatPerDay(current.submitted, paceDays), formatPerDay(previous.submitted, days)],
    ['Оценка на месяц', formatByCurrency(monthEstimate(current.turnover, paceDays)), '—'],
  );
  return {
    key: 'summary',
    title: 'Показатели',
    note: 'Плитки, сроки, рекорды и прогноз — за период и за такой же период перед ним',
    columns: ['Показатель', 'За период', 'За прошлый период'],
    rows,
  };
}

/**
 * Отчёт целиком — все таблицы одним файлом, по порядку страницы.
 * Каждой предшествует строка с её названием, после — пустая строка:
 * так разделы видны в Excel без листов и без форматирования.
 */
export function reportRows(
  tables: readonly AnalyticsTable[],
  heading: readonly Cell[],
): (readonly Cell[])[] {
  const rows: (readonly Cell[])[] = [heading, []];
  for (const table of tables) {
    rows.push([table.title], table.columns, ...table.rows, []);
  }
  return rows;
}
