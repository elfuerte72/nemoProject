import { describe, expect, it } from 'vitest';
import { recipientCurrency } from './recipient-rows';

/**
 * У записи получателя нет своей валюты — её называет род: по телефону
 * и на карту приходят рубли, на кошелёк USDT, на тайский счёт и
 * PromptPay баты, на Alipay юани. Список получателей группируется по
 * этому правилу, и правило берётся из доменных типов, а не пишется
 * здесь второй раз.
 */
describe('валюта записи получателя', () => {
  it('выводится из рода записи', () => {
    expect(recipientCurrency('card')).toBe('RUB');
    expect(recipientCurrency('phone')).toBe('RUB');
    expect(recipientCurrency('wallet')).toBe('USDT');
    expect(recipientCurrency('account')).toBe('THB');
    expect(recipientCurrency('promptpay')).toBe('THB');
    expect(recipientCurrency('alipay')).toBe('CNY');
    expect(recipientCurrency('alipay_qr')).toBe('CNY');
  });
});
