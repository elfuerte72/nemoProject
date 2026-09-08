import { describe, expect, it } from 'vitest';
import { codeLink, newCodeObstacle, shareUrl } from './referral-codes-view';

/**
 * Форма кода говорит, что мешает, до нажатия — тем же правилом, каким
 * отвергнет ядро: `promoCodeSchema` одна на форму и операцию.
 */
describe('препятствия к новому коду', () => {
  it('ссылке нужно название, промокоду — ещё и слово по правилу', () => {
    expect(newCodeObstacle({ kind: 'link', label: '  ', code: '' })).toMatch(/назов/i);
    expect(newCodeObstacle({ kind: 'link', label: 'Сторис', code: '' })).toBeNull();
    expect(newCodeObstacle({ kind: 'promo', label: 'Лето', code: 'abc' })).toMatch(/от 4 знаков/);
    expect(newCodeObstacle({ kind: 'promo', label: 'Лето', code: 'tobee' })).toMatch(/занято/);
    expect(newCodeObstacle({ kind: 'promo', label: 'Лето', code: 'summer26' })).toBeNull();
    expect(newCodeObstacle({ kind: 'link', label: 'а'.repeat(41), code: '' })).toMatch(/40/);
  });
});

describe('ссылка по коду', () => {
  it('у ссылки — адрес бота, у промокода — слово без адреса', () => {
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = 'devnemobot_bot';
    expect(codeLink({ kind: 'link', code: 'X5C4MZV8TB' })).toBe(
      'https://t.me/devnemobot_bot?startapp=X5C4MZV8TB',
    );
    expect(codeLink({ kind: 'promo', code: 'SUMMER26' })).toBeUndefined();
  });

  it('«поделиться» — адрес Telegram с текстом', () => {
    const url = shareUrl('https://t.me/b?startapp=X', 'Меняю через Tobee');
    expect(url.startsWith('https://t.me/share/url?')).toBe(true);
    expect(decodeURIComponent(url)).toContain('startapp=X');
    expect(decodeURIComponent(url)).toContain('Меняю через Tobee');
  });
});
