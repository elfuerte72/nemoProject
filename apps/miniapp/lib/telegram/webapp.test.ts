import { describe, expect, it } from 'vitest';
import { wantsFullscreen } from './webapp.js';

/**
 * Полный экран просится только там, где экрана мало.
 *
 * Шапка Telegram над приложением — потерянная полоса, и на телефоне она
 * стоит формы обмена, которая помещается впритык. На ноутбуке этой беды
 * нет: Mini App открывается своим окном рядом с перепиской, и разворот
 * во весь монитор закрывает собой Telegram, из которого клиент пришёл.
 *
 * До 18 сентября 2026 полный экран просился у всех, а комментарий рядом
 * уверял, что десктоп такую просьбу не понимает и остаётся в окне.
 * Telegram Desktop на macOS понял её и развернулся во весь экран.
 *
 * Список — из мобильных, а не из настольных: незнакомая платформа
 * получает окно. Ошибиться в эту сторону дёшево, в обратную — нет.
 */
describe('wantsFullscreen', () => {
  it('телефон разворачивается: экрана там мало', () => {
    expect(wantsFullscreen('ios')).toBe(true);
    expect(wantsFullscreen('android')).toBe(true);
    expect(wantsFullscreen('android_x')).toBe(true);
  });

  it('настольный клиент остаётся окном', () => {
    expect(wantsFullscreen('tdesktop')).toBe(false);
    expect(wantsFullscreen('macos')).toBe(false);
  });

  it('в браузере тоже окно: там Telegram — это вкладка рядом', () => {
    expect(wantsFullscreen('web')).toBe(false);
    expect(wantsFullscreen('weba')).toBe(false);
    expect(wantsFullscreen('webk')).toBe(false);
  });

  it('незнакомая платформа и молчание — окно', () => {
    expect(wantsFullscreen('unigram')).toBe(false);
    expect(wantsFullscreen(undefined)).toBe(false);
    expect(wantsFullscreen('')).toBe(false);
  });

  it('регистр и пробелы вокруг названия не мешают', () => {
    expect(wantsFullscreen('IOS')).toBe(true);
    expect(wantsFullscreen(' android ')).toBe(true);
  });
});
