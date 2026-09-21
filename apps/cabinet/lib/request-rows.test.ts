import { describe, expect, it } from 'vitest';
import { pickSearch, SEARCH_MAX, tabHref } from './request-rows.js';

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
