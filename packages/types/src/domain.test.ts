import { describe, expect, it } from 'vitest';
import { looksLikeCardNumber, looksLikePhone, looksLikeWalletAddress } from './domain.js';

/**
 * Проверки реквизита ловят опечатку, а не подделку. Поэтому и примеры
 * здесь — не «неверный формат», а то, чем ошибается человек: переставил
 * две цифры, не дописал адрес до конца, вставил его из чужой сети.
 */

describe('looksLikeCardNumber', () => {
  it('принимает номер, сходящийся по контрольной сумме', () => {
    // Тестовые номера платёжных систем — они и предназначены для примеров.
    expect(looksLikeCardNumber('4111111111111111')).toBe(true);
    expect(looksLikeCardNumber('5555555555554444')).toBe(true);
    // Пробелы клиент набирает сам или их ставит маска.
    expect(looksLikeCardNumber('4111 1111 1111 1111')).toBe(true);
  });

  it('отвергает переставленные цифры', () => {
    // Та же карта, но две соседние цифры поменялись местами.
    expect(looksLikeCardNumber('5555555555544454')).toBe(false);
  });

  it('отвергает недобитый и слишком длинный номер', () => {
    expect(looksLikeCardNumber('411111111111')).toBe(false);
    expect(looksLikeCardNumber('41111111111111111111')).toBe(false);
    expect(looksLikeCardNumber('')).toBe(false);
  });

  it('отвергает номер телефона на месте карты', () => {
    expect(looksLikeCardNumber('+7 900 123-45-67')).toBe(false);
  });

  it('отвергает номер, окружённый чужими знаками', () => {
    // Отбрасывать всё нецифровое мало: так проходит и «моя карта
    // 4111111111111111», и адрес кошелька, в котором нашлись цифры.
    expect(looksLikeCardNumber('карта 4111111111111111')).toBe(false);
    expect(looksLikeCardNumber('4111111111111111 (основная)')).toBe(false);
  });
});

describe('looksLikePhone', () => {
  it('принимает номера разных стран в любой записи', () => {
    expect(looksLikePhone('+7 900 123-45-67')).toBe(true);
    expect(looksLikePhone('89001234567')).toBe(true);
    // Таиланд: девять цифр после кода страны.
    expect(looksLikePhone('+66 81 234 5678')).toBe(true);
  });

  it('отвергает слишком короткое и слишком длинное', () => {
    expect(looksLikePhone('123456789')).toBe(false);
    expect(looksLikePhone('1234567890123456')).toBe(false);
    expect(looksLikePhone('')).toBe(false);
  });

  it('отвергает номер с чужими знаками вокруг', () => {
    expect(looksLikePhone('телефон +79001234567')).toBe(false);
  });
});

describe('looksLikeWalletAddress', () => {
  it('принимает адрес TRC20', () => {
    expect(looksLikeWalletAddress('TRC20', 'TN1sKgqPzVTQ7dxUCiP5bkfEsBLK7SnbMD')).toBe(true);
  });

  it('отвергает обрезанный адрес TRC20 и чужой формат', () => {
    expect(looksLikeWalletAddress('TRC20', 'TN1sKgqPzVTQ7dxUCiP5bkfEsBLK7Snb')).toBe(false);
    // Адрес Ethereum, вставленный в поле сети Tron.
    expect(looksLikeWalletAddress('TRC20', '0x71C7656EC7ab88b098defB751B7401B5f6d8976F')).toBe(
      false,
    );
    // Base58 не содержит нуля, «O», «I» и «l» — в них и ошибаются, переписывая с экрана.
    expect(looksLikeWalletAddress('TRC20', 'TN1sKgqPzVTQ7dxUCiP5bkfEsBLK7Snb0O')).toBe(false);
  });

  it('принимает оба вида адреса TON', () => {
    expect(looksLikeWalletAddress('TON', 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N')).toBe(
      true,
    );
    expect(
      looksLikeWalletAddress(
        'TON',
        '0:83dfd552e6372da472fcbcc8c45ebcc669170255962da1ec7527e1ba403a0f31',
      ),
    ).toBe(true);
  });

  it('отвергает недописанный адрес TON', () => {
    expect(looksLikeWalletAddress('TON', 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn')).toBe(false);
  });

  it('не мешает сети, которой не знает', () => {
    // Администратор заводит сеть в справочнике, а не в коде: незнакомая
    // не должна переставать работать до того, как её впишут сюда.
    expect(looksLikeWalletAddress('SOL', 'что-нибудь')).toBe(true);
    expect(looksLikeWalletAddress('SOL', '   ')).toBe(false);
  });

  it('узнаёт сеть независимо от регистра', () => {
    expect(looksLikeWalletAddress('trc20', 'TN1sKgqPzVTQ7dxUCiP5bkfEsBLK7SnbMD')).toBe(true);
  });
});
