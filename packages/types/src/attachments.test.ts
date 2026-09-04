import { describe, expect, it } from 'vitest';
import { isBrowserImage, looksLikeImage } from './attachments.js';

/*
 * Чем показать вложение, панель решает до запроса, а тип ей называет
 * клиент — и называет как придётся: «image/jpg» вместо «image/jpeg»,
 * «application/octet-stream» у скриншота, отправленного файлом. Ошибка в
 * обе стороны видна человеку: картинка, показанная ссылкой, и документ,
 * показанный битой картинкой.
 */
describe('isBrowserImage', () => {
  it('только то, что браузер рисует сам', () => {
    expect(isBrowserImage('image/jpeg')).toBe(true);
    expect(isBrowserImage('image/png')).toBe(true);
    expect(isBrowserImage('image/gif')).toBe(true);
    expect(isBrowserImage('image/webp')).toBe(true);
  });

  it('исполняемое и незнакомое браузеру — нет', () => {
    expect(isBrowserImage('image/svg+xml')).toBe(false);
    expect(isBrowserImage('image/heic')).toBe(false);
    expect(isBrowserImage('application/pdf')).toBe(false);
    expect(isBrowserImage(null)).toBe(false);
  });
});

describe('looksLikeImage', () => {
  it('узнаёт картинку по типу', () => {
    expect(looksLikeImage('image/png', null)).toBe(true);
    // Нестандартный, но встречается у клиентов Android.
    expect(looksLikeImage('image/jpg', null)).toBe(true);
  });

  it('узнаёт её по имени, когда тип ни о чём не говорит', () => {
    expect(looksLikeImage('application/octet-stream', 'screen.PNG')).toBe(true);
    expect(looksLikeImage(null, 'снимок экрана.jpeg')).toBe(true);
  });

  it('не принимает за картинку то, что браузер не нарисует', () => {
    expect(looksLikeImage('image/heic', 'IMG_0042.HEIC')).toBe(false);
    expect(looksLikeImage('image/svg+xml', 'схема.svg')).toBe(false);
    expect(looksLikeImage('application/pdf', 'чек.pdf')).toBe(false);
    expect(looksLikeImage(null, 'договор.docx')).toBe(false);
    expect(looksLikeImage(null, null)).toBe(false);
  });
});
