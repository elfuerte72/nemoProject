import { describe, expect, it } from 'vitest';
import { resolveStep, SERIES_STEP_KEYS, STEP_KEYS } from './analytics-texts';
import { barLabel, barLabelled, barTitle, SERIES_SPAN } from './series-labels';

/**
 * Подписи столбиков ряда.
 *
 * Корзина у всех четырёх шагов названа одним ключом — днём своего
 * начала, — и что именно писать под столбиком, решает шаг. Правило
 * закреплено тестом, потому что ошибка в нём тихая: «III·26» вместо
 * «III·25» выглядит подписью, а не ошибкой, и заметит её только тот,
 * кто помнит свой прошлогодний оборот.
 */

describe('подпись под столбиком', () => {
  it('день — числом, без месяца: месяц стоит в строке чисел', () => {
    expect(barLabel('2026-09-02', 'day')).toBe('02');
  });

  it('неделя — днём и месяцем начала: одного числа на двенадцати мало', () => {
    expect(barLabel('2026-09-14', 'week')).toBe('14.09');
  });

  it('месяц — тремя буквами', () => {
    expect(barLabel('2026-09-01', 'month')).toBe('сен');
    expect(barLabel('2026-05-01', 'month')).toBe('май');
  });

  it('квартал — римской цифрой и годом: за два года III встречается дважды', () => {
    expect(barLabel('2026-07-01', 'quarter')).toBe('III·26');
    expect(barLabel('2025-01-01', 'quarter')).toBe('I·25');
    expect(barLabel('2025-10-01', 'quarter')).toBe('IV·25');
  });
});

describe('название корзины в строке чисел', () => {
  it('день — числом и месяцем', () => {
    expect(barTitle('2026-09-02', 'day')).toBe('2.09');
  });

  it('неделя — целиком, от понедельника до воскресенья', () => {
    expect(barTitle('2026-09-14', 'week')).toBe('14.09 – 20.09');
    // Неделя, перешагнувшая месяц, называет оба.
    expect(barTitle('2026-08-31', 'week')).toBe('31.08 – 6.09');
  });

  it('месяц — словом и годом', () => {
    expect(barTitle('2026-09-01', 'month')).toBe('сентябрь 2026');
  });

  it('квартал — римской цифрой и годом', () => {
    expect(barTitle('2026-07-01', 'quarter')).toBe('III квартал 2026');
  });
});

describe('состав выбора', () => {
  it('на обзоре шагов четыре, и квартал среди них', () => {
    expect(SERIES_STEP_KEYS).toEqual(['day', 'week', 'month', 'quarter']);
  });

  /*
   * В аналитике ряд идёт по выбранному наверху периоду, а он не длиннее
   * ста восьмидесяти дней: квартальными столбиками там нечего
   * сравнивать — их было бы два.
   */
  it('в аналитике квартала нет', () => {
    expect(STEP_KEYS).toEqual(['day', 'week', 'month']);
  });

  it('шаг из адреса сверяется со списком того экрана, который спрашивает', () => {
    expect(resolveStep('quarter', SERIES_STEP_KEYS)).toBe('quarter');
    expect(resolveStep('quarter')).toBe('day');
    expect(resolveStep('годами', SERIES_STEP_KEYS)).toBe('day');
    expect(resolveStep(undefined, SERIES_STEP_KEYS)).toBe('day');
  });
});

describe('какие столбики подписаны', () => {
  /*
   * Решает не шаг, а ширина подписи: под столбик её приходится
   * впятеро меньше, чем кажется на ноутбуке, и «14.09» двенадцать раз
   * подряд на телефоне слипается в полосу. Лишние гасятся через одну,
   * считая от последней: последняя корзина — это «сейчас», и без
   * подписи она остаться не может.
   */
  it('днями подписан каждый: под числом из двух знаков место есть', () => {
    expect(barLabelled(14, 'day')).toEqual(Array.from({ length: 14 }, () => true));
  });

  it('неделями — через одну, и последняя обязательно', () => {
    expect(barLabelled(12, 'week')).toEqual([
      false, true, false, true, false, true, false, true, false, true, false, true,
    ]);
  });

  it('месяцами — каждый: три буквы помещаются', () => {
    expect(barLabelled(12, 'month')).toEqual(Array.from({ length: 12 }, () => true));
  });

  it('кварталов восемь, и подписаны все', () => {
    expect(barLabelled(8, 'quarter')).toEqual(Array.from({ length: 8 }, () => true));
  });
});

describe('подпись под заголовком', () => {
  /*
   * Числа здесь те же, что у `SERIES_BUCKETS` в ядре: «за две недели»
   * под рядом из двенадцати недель — не описка, а вторая правда о тех
   * же столбиках.
   */
  it('называет отрезок тем же числом, каким ряд посчитан', () => {
    expect(SERIES_SPAN.day).toBe('за две недели');
    expect(SERIES_SPAN.week).toBe('за двенадцать недель');
    expect(SERIES_SPAN.month).toBe('за год');
    expect(SERIES_SPAN.quarter).toBe('за два года');
  });
});
