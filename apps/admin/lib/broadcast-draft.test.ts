import { describe, expect, it } from 'vitest';
import { attemptFor, parseStoredAttempt } from './broadcast-draft';

/**
 * Ключ повтора рассылки.
 *
 * Ключ принадлежит тексту, который уже пытались отправить, а не
 * последнему нажатию клавиши: до правки по ревью 17 сентября 2026 форма
 * меняла ключ на каждое изменение поля, и администратор, дописавший
 * «!» и стёрший его после оборванного запроса, отправлял тот же текст с
 * новым ключом — рассылка уходила всем второй раз.
 */

let counter = 0;
const makeKey = () => `K${(counter += 1)}`;

describe('ключ попытки рассылки', () => {
  it('новый, пока этот текст не пытались отправить', () => {
    const attempt = attemptFor('  Акция  ', undefined, makeKey);

    expect(attempt.body).toBe('Акция');
    expect(attempt.key).toMatch(/^K\d+$/);
  });

  it('прежний для того же текста, что бы ни набирали между попытками', () => {
    const first = attemptFor('Акция', undefined, makeKey);

    expect(attemptFor('Акция ', first, makeKey)).toEqual(first);
  });

  it('новый для другого текста: это другой черновик', () => {
    const first = attemptFor('Акция', undefined, makeKey);

    const second = attemptFor('Акция!', first, makeKey);

    expect(second.body).toBe('Акция!');
    expect(second.key).not.toBe(first.key);
  });
});

describe('попытка, сохранённая во вкладке', () => {
  it('читается обратно', () => {
    expect(parseStoredAttempt(JSON.stringify({ body: 'Акция', key: 'K1' }))).toEqual({
      body: 'Акция',
      key: 'K1',
    });
  });

  it('пустая, испорченная или чужой формы — как не было', () => {
    expect(parseStoredAttempt(null)).toBeUndefined();
    expect(parseStoredAttempt('{')).toBeUndefined();
    expect(parseStoredAttempt(JSON.stringify({ body: 'Акция' }))).toBeUndefined();
    expect(parseStoredAttempt(JSON.stringify({ body: 'Акция', key: '' }))).toBeUndefined();
    expect(parseStoredAttempt(JSON.stringify(['Акция', 'K1']))).toBeUndefined();
  });
});
