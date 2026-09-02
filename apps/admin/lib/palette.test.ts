import { describe, expect, it } from 'vitest';
import { classifyQuery, directHref } from './palette';

describe('разбор ввода палитры', () => {
  it('полный UUID — заявка, и ведёт в карточку', () => {
    const query = classifyQuery(' 3D7C7B7E-F750-49A9-830C-F2CC1684B29D ');
    expect(query).toEqual({ kind: 'request', id: '3d7c7b7e-f750-49a9-830c-f2cc1684b29d' });
    expect(directHref(query)).toBe('/exchange-requests/3d7c7b7e-f750-49a9-830c-f2cc1684b29d');
  });

  it('число — клиент, и ведёт в переписку', () => {
    const query = classifyQuery('8421518682');
    expect(query).toEqual({ kind: 'client', id: '8421518682' });
    expect(directHref(query)).toBe('/conversations/8421518682');
  });

  it('слово — поиск, собака у ника отбрасывается', () => {
    expect(classifyQuery('@tobee')).toEqual({ kind: 'search', query: 'tobee' });
    expect(directHref(classifyQuery('tobee'))).toBeNull();
  });

  it('пусто и одна буква — не поиск', () => {
    expect(classifyQuery('   ')).toEqual({ kind: 'empty' });
    expect(classifyQuery('a')).toEqual({ kind: 'short' });
    expect(classifyQuery('@a')).toEqual({ kind: 'short' });
  });
});
