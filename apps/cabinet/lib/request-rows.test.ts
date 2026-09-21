import { describe, expect, it } from 'vitest';
import { boundsOf, pickPeriod, pickSearch, SEARCH_MAX, tabHref } from './request-rows.js';

/**
 * Запрос поиска приходит из адресной строки — то есть от кого угодно и
 * какой угодно. Правило одно на страницу и на маршрут дочитывания:
 * разойдись они, вторая страница искала бы не то, что первая.
 */
describe('запрос поиска из адреса', () => {
  it('края обрезаются: номер копируют вместе с пробелами', () => {
    expect(pickSearch('  order-1013 ')).toBe('order-1013');
  });

  it('пустой и отсутствующий — одно и то же: поиска нет', () => {
    expect(pickSearch(undefined)).toBe('');
    expect(pickSearch('   ')).toBe('');
  });

  /*
   * Найдено ревью 21 сентября 2026. Нулевой байт в текстовом параметре
   * база отвергает ошибкой, и `/requests?q=%00` отвечал пятисотым — а
   * адресной строке отказом не отвечают.
   */
  it('управляющие знаки вычищаются: нулевой байт база не принимает', () => {
    expect(pickSearch('order\u0000-1013')).toBe('order-1013');
    expect(pickSearch('\u0000')).toBe('');
    expect(pickSearch('за\tказ\n1013')).toBe('заказ1013');
  });

  it('длинный обрезается, а не отвергается: это адрес, а не форма', () => {
    expect(pickSearch('я'.repeat(500))).toHaveLength(SEARCH_MAX);
  });
});

describe('адрес таба', () => {
  it('без поиска — только таб', () => {
    expect(tabHref('completed', '')).toBe('/requests?tab=completed');
  });

  /*
   * Сверяется разобранный адрес, а не строка: пробел в запросе законно
   * пишется и плюсом, и `%20`, и важно не то, как он записан, а то, что
   * страница прочтёт из адреса ровно набранное.
   */
  it('с поиском несёт его с собой: иначе таб сбрасывал бы найденное', () => {
    const read = new URL(tabHref('all', 'Бронь №1 100%'), 'https://cabinet.example');
    expect(read.pathname).toBe('/requests');
    expect(read.searchParams.get('tab')).toBe('all');
    expect(read.searchParams.get('q')).toBe('Бронь №1 100%');
  });
});

/**
 * Период списка заявок. Отличие от обзора одно, и оно главное: у списка
 * периода может не быть вовсе. Обзор без периода не посчитать, и там
 * незнакомый адрес значит «тридцать дней»; а список без периода — это
 * все заявки, и молча сузить его до месяца значило бы спрятать от
 * мерчанта заявку, за которой он пришёл.
 */
describe('период списка из адреса', () => {
  const now = new Date('2026-09-21T10:00:00Z');

  it('без периода — всё время', () => {
    expect(pickPeriod({}, now, 0)).toBeNull();
  });

  it('незнакомый ключ — всё время, а не молчаливые тридцать дней', () => {
    expect(pickPeriod({ period: 'вчера' }, now, 0)).toBeNull();
    // «Сегодня» у обзора есть, у списка среди чипов нет — и адрес его не знает.
    expect(pickPeriod({ period: 'today' }, now, 0)).toBeNull();
  });

  it('неделя, месяц и три месяца — по сегодняшний день включительно', () => {
    const week = pickPeriod({ period: '7d' }, now, 0);
    expect(week?.period.from.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(week?.period.to.toISOString()).toBe('2026-09-22T00:00:00.000Z');
    expect(week?.query).toEqual({ period: '7d' });
    expect(pickPeriod({ period: '30d' }, now, 0)?.period.key).toBe('30d');
    expect(pickPeriod({ period: '90d' }, now, 0)?.period.key).toBe('90d');
  });

  /*
   * Поля «с» и «по» показывают границы и у быстрого периода — как на
   * обзоре: «7 дней» без чисел оставляет гадать, входит ли сегодня, а
   * свой период удобнее начинать с готового отрезка, чем с пустых полей.
   */
  it('дни периода названы всегда, а в адрес идут только у своего', () => {
    const week = pickPeriod({ period: '7d' }, now, 0);
    expect(week?.days).toEqual({ from: '2026-09-15', to: '2026-09-21' });
    expect(week?.query).toEqual({ period: '7d' });
  });

  it('свой период — с числа по число, оба дня включительно', () => {
    const own = pickPeriod({ period: 'custom', from: '2026-09-01', to: '2026-09-10' }, now, 0);
    expect(own?.period.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(own?.period.to.toISOString()).toBe('2026-09-11T00:00:00.000Z');
    expect(own?.query).toEqual({ period: 'custom', from: '2026-09-01', to: '2026-09-10' });
  });

  it('даты задом наперёд называют те же дни', () => {
    const own = pickPeriod({ period: 'custom', from: '2026-09-10', to: '2026-09-01' }, now, 0);
    expect(own?.query).toEqual({ period: 'custom', from: '2026-09-01', to: '2026-09-10' });
  });

  it('свой период без дат или с битыми — всё время', () => {
    expect(pickPeriod({ period: 'custom' }, now, 0)).toBeNull();
    expect(pickPeriod({ period: 'custom', from: '2026-13-40', to: 'завтра' }, now, 0)).toBeNull();
  });

  it('день считается по часам того, кто смотрит', () => {
    // В Бангкоке (UTC+7) 21 сентября началось в 17:00 UTC двадцатого.
    const own = pickPeriod(
      { period: 'custom', from: '2026-09-21', to: '2026-09-21' },
      now,
      7 * 60,
    );
    expect(own?.period.from.toISOString()).toBe('2026-09-20T17:00:00.000Z');
    expect(own?.period.to.toISOString()).toBe('2026-09-21T17:00:00.000Z');
    expect(own?.query).toEqual({ period: 'custom', from: '2026-09-21', to: '2026-09-21' });
  });
});

/*
 * Верхняя граница у отбора ядра включительная, у периода — нет. Перевод
 * из одного в другое жил строкой в выгрузке CSV; теперь им пользуются
 * ещё страница и дочитывание, и трёх копий «минус миллисекунда» быть не
 * должно.
 */
describe('границы отбора', () => {
  it('у периода — с начала первого дня по последнюю миллисекунду последнего', () => {
    const picked = pickPeriod({ period: 'custom', from: '2026-09-01', to: '2026-09-10' }, new Date(), 0);
    const bounds = boundsOf(picked);
    expect(bounds.from?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(bounds.to?.toISOString()).toBe('2026-09-10T23:59:59.999Z');
  });

  it('без периода границ нет вовсе', () => {
    expect(boundsOf(null)).toEqual({});
  });
});

describe('адрес таба с периодом', () => {
  it('несёт и поиск, и период: плитка не сбрасывает ни то, ни другое', () => {
    const read = new URL(
      tabHref('completed', 'order', { period: 'custom', from: '2026-09-01', to: '2026-09-10' }),
      'https://cabinet.example',
    );
    expect(Object.fromEntries(read.searchParams)).toEqual({
      tab: 'completed',
      q: 'order',
      period: 'custom',
      from: '2026-09-01',
      to: '2026-09-10',
    });
  });

  it('без периода адрес прежний', () => {
    expect(tabHref('completed', '')).toBe('/requests?tab=completed');
    expect(tabHref('completed', '', {})).toBe('/requests?tab=completed');
  });
});
