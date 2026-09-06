import { describe, expect, it } from 'vitest';
import { knowledgeTitleFamily, normalizeKnowledgeTitle } from './knowledge.js';

describe('одноимённость статей базы знаний', () => {
  it('не различает регистр и лишние пробелы', () => {
    expect(normalizeKnowledgeTitle('  График   работы ')).toBe(normalizeKnowledgeTitle('график работы'));
  });

  it('разные названия остаются разными', () => {
    expect(normalizeKnowledgeTitle('График работы')).not.toBe(normalizeKnowledgeTitle('График'));
  });
});

describe('тема статьи без номера части', () => {
  it('снимает номер части, оставляя название', () => {
    expect(knowledgeTitleFamily('Как проходит обмен (2)')).toBe(normalizeKnowledgeTitle('Как проходит обмен'));
    expect(knowledgeTitleFamily('Оплата')).toBe('оплата');
  });

  it('скобки внутри названия не считает номером', () => {
    expect(knowledgeTitleFamily('Оплата (СБП) картой')).toBe('оплата (сбп) картой');
  });
});
