import { isCoreError } from '@nemo/http';
import { isReferralLine, type ReferralLine } from '@nemo/types';
import { firstParam } from '@nemo/ui';
import type { Period } from '@nemo/ui/period';

/**
 * Параметры адреса кабинета амбассадора.
 *
 * Адрес правит кто угодно, и опечатка в нём не повод для страницы
 * аварии. Что можно привести к допустимому, приводится здесь: линия,
 * которой не бывает, — это «все линии», смещение, которое база не
 * примет, — первая страница. Отказ ядра, которого не привести, страница
 * называет словами (`readForPeriod`).
 */

type Params = Record<string, string | string[] | undefined>;

export interface PeopleQuery {
  readonly line?: ReferralLine;
  readonly offset: number;
}

export function readPeopleQuery(params: Params): PeopleQuery {
  const line = Number(firstParam(params.line));
  const asked = Number(firstParam(params.offset));
  /*
   * Целое — безопасное целое: `1e300` для `Number.isInteger` целое, а
   * база такое смещение не разбирает. Линия — по той же таблице, по
   * которой её проверяет ядро: пятой в адресе хватает, девятой не бывает.
   */
  const offset = Number.isSafeInteger(asked) && asked > 0 ? asked : 0;
  return isReferralLine(line) ? { line, offset } : { offset };
}

export interface PeriodRead<T> {
  readonly period: Period;
  readonly data: T;
  /** Почему показан не спрошенный период; пусто — показан спрошенный. */
  readonly refusal: string | null;
}

/**
 * Сводка за период из адреса — или, если ядро такой период не считает,
 * за период по умолчанию и с отказом словами.
 *
 * Период набирают в полях «С / По», и «с прошлого января» — законный
 * вопрос, на который у кабинета предел в год. Отвечать на него
 * страницей аварии нельзя, а пустым экраном — незачем: числа за
 * тридцать дней рядом со словами «период — не длиннее года» отвечают и
 * на вопрос, и на то, что делать дальше. Прочие ошибки не подменяются.
 */
export async function readForPeriod<T>(
  asked: Period,
  fallback: Period,
  read: (period: Period) => Promise<T>,
): Promise<PeriodRead<T>> {
  try {
    return { period: asked, data: await read(asked), refusal: null };
  } catch (error) {
    if (!isCoreError(error) || error.code !== 'invalid-input') throw error;
    return { period: fallback, data: await read(fallback), refusal: error.message };
  }
}
