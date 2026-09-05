import { describe, expect, it } from 'vitest';
import { normalizeKnowledgeTitle } from './knowledge.js';

describe('одноимённость статей базы знаний', () => {
  it('не различает регистр и лишние пробелы', () => {
    expect(normalizeKnowledgeTitle('  График   работы ')).toBe(normalizeKnowledgeTitle('график работы'));
  });

  it('разные названия остаются разными', () => {
    expect(normalizeKnowledgeTitle('График работы')).not.toBe(normalizeKnowledgeTitle('График'));
  });
});
