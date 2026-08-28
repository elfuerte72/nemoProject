import { describe, expect, it } from 'vitest';
import {
  alipayQrHint,
  looksLikeAlipayAccount,
  looksLikeAlipayQr,
  looksLikeCardNumber,
  looksLikeHolderName,
  looksLikePhone,
  looksLikeThaiAccountNumber,
  looksLikeWalletAddress,
  parsePromptPay,
  payoutMethodOf,
  promptPayHint,
  serviceAccountKindSuits,
  requisiteKindSuitsCurrency,
  requisiteCurrencyCodes,
  requisiteKindsFor,
} from './domain.js';

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
    // Дружественный адрес приходит и в обычном base64: кошельки отдают
    // его с «+» и «/», и отвергнутый настоящий адрес хуже пропущенной
    // опечатки — по нему клиент вовсе не сможет получить деньги.
    expect(looksLikeWalletAddress('TON', 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpA+g8xqB2N')).toBe(
      true,
    );
    expect(looksLikeWalletAddress('TON', 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpA/g8xqB2N')).toBe(
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

/*
 * Четыре новых рода записи — тайский счёт, PromptPay, Alipay по
 * аккаунту и по QR — заведены 28 августа 2026 по письму владельца.
 * Какие роды подходят валюте, говорит таблица здесь же: по ней ядро
 * принимает запись к заявке, а экран показывает подходящие роды формы.
 */
describe('requisiteKindsFor', () => {
  it('рубли — телефон и карта, USDT — кошелёк', () => {
    expect(requisiteKindsFor('RUB')).toEqual(['phone', 'card']);
    expect(requisiteKindsFor('USDT')).toEqual(['wallet']);
  });

  it('баты — счёт и PromptPay, юани — Alipay и Alipay-QR', () => {
    expect(requisiteKindsFor('THB')).toEqual(['account', 'promptpay']);
    expect(requisiteKindsFor('CNY')).toEqual(['alipay', 'alipay_qr']);
  });

  it('у прочих валют выдачи родов пока нет: клиент видит «в разработке»', () => {
    expect(requisiteKindsFor('EUR')).toEqual([]);
    expect(requisiteKindsFor('USD')).toEqual([]);
    expect(requisiteKindsFor('TRY')).toEqual([]);
  });

  it('не зависит от регистра кода', () => {
    expect(requisiteKindsFor('thb')).toEqual(['account', 'promptpay']);
  });

  it('называет валюты, у которых роды есть, — для формы в профиле', () => {
    expect([...requisiteCurrencyCodes()].sort()).toEqual(['CNY', 'RUB', 'THB', 'USDT']);
  });

  it('подходит ли род валюте — по той же таблице', () => {
    expect(requisiteKindSuitsCurrency('account', 'THB')).toBe(true);
    expect(requisiteKindSuitsCurrency('card', 'THB')).toBe(false);
    expect(requisiteKindSuitsCurrency('alipay', 'CNY')).toBe(true);
    expect(requisiteKindSuitsCurrency('phone', 'CNY')).toBe(false);
    expect(requisiteKindSuitsCurrency('card', 'EUR')).toBe(false);
  });
});

/*
 * Счета сервиса заводятся только в валютах, которые сервис принимает, —
 * рублях и USDT, — и прежняя проверка по природе валюты остаётся у них.
 * Новые роды она не пропускает: тайский счёт — фиатный, но рубли на
 * него не приходят.
 */
describe('serviceAccountKindSuits', () => {
  it('фиат — телефон и карта, крипта — кошелёк', () => {
    expect(serviceAccountKindSuits('phone', 'fiat')).toBe(true);
    expect(serviceAccountKindSuits('card', 'fiat')).toBe(true);
    expect(serviceAccountKindSuits('wallet', 'crypto')).toBe(true);
    expect(serviceAccountKindSuits('wallet', 'fiat')).toBe(false);
  });

  it('новые роды не пропускает ни у фиата, ни у крипты', () => {
    expect(serviceAccountKindSuits('account', 'fiat')).toBe(false);
    expect(serviceAccountKindSuits('promptpay', 'fiat')).toBe(false);
    expect(serviceAccountKindSuits('alipay', 'fiat')).toBe(false);
    expect(serviceAccountKindSuits('alipay_qr', 'crypto')).toBe(false);
  });
});

/*
 * Способ выдачи — банк или кошелёк — выбирает сетку комиссии, и у
 * PromptPay он зависит не от рода, а от того, что внутри QR: телефон и
 * ID-карта привязаны к банковскому счёту, пятнадцатизначный номер — к
 * электронному кошельку.
 */
describe('payoutMethodOf', () => {
  it('телефон, карта и тайский счёт — банк', () => {
    expect(payoutMethodOf({ kind: 'phone', promptpayIdType: null })).toBe('bank');
    expect(payoutMethodOf({ kind: 'card', promptpayIdType: null })).toBe('bank');
    expect(payoutMethodOf({ kind: 'account', promptpayIdType: null })).toBe('bank');
  });

  it('криптокошелёк и оба Alipay — кошелёк', () => {
    expect(payoutMethodOf({ kind: 'wallet', promptpayIdType: null })).toBe('wallet');
    expect(payoutMethodOf({ kind: 'alipay', promptpayIdType: null })).toBe('wallet');
    expect(payoutMethodOf({ kind: 'alipay_qr', promptpayIdType: null })).toBe('wallet');
  });

  it('PromptPay — по типу идентификатора внутри QR', () => {
    expect(payoutMethodOf({ kind: 'promptpay', promptpayIdType: 'ewallet' })).toBe('wallet');
    expect(payoutMethodOf({ kind: 'promptpay', promptpayIdType: 'phone' })).toBe('bank');
    expect(payoutMethodOf({ kind: 'promptpay', promptpayIdType: 'national_id' })).toBe('bank');
  });
});

describe('looksLikeThaiAccountNumber', () => {
  it('принимает десять цифр — с разделителями банка и без', () => {
    // Пример владельца: так номер напечатан в тайском приложении.
    expect(looksLikeThaiAccountNumber('766-0-246658')).toBe(true);
    expect(looksLikeThaiAccountNumber('7660246658')).toBe(true);
    expect(looksLikeThaiAccountNumber('766 0 24665 8')).toBe(true);
  });

  it('принимает двенадцать: столько у GSB и BAAC', () => {
    expect(looksLikeThaiAccountNumber('020123456789')).toBe(true);
  });

  it('отвергает не то число цифр: опечатка, а не другой банк', () => {
    expect(looksLikeThaiAccountNumber('766024665')).toBe(false);
    expect(looksLikeThaiAccountNumber('7660246658123')).toBe(false);
    expect(looksLikeThaiAccountNumber('')).toBe(false);
  });

  it('отвергает номер с чужими знаками вокруг', () => {
    expect(looksLikeThaiAccountNumber('счёт 7660246658')).toBe(false);
    expect(looksLikeThaiAccountNumber('KBank 766-0-246658')).toBe(false);
  });
});

/*
 * Строки собраны по стандарту EMVCo MPM с приложением PromptPay
 * (`A000000677010111`) и контрольной суммой CRC-16/CCITT-FALSE —
 * генератором, а не переписаны из чужого QR: оригиналы картинок
 * владельца ещё не пришли, и фикстуры заменятся ими.
 */
const PROMPTPAY_PHONE = '00020101021129370016A0000006770101110113006681234567853037645802TH6304823E';
const PROMPTPAY_NATIONAL_ID =
  '00020101021129370016A0000006770101110213123456789012353037645802TH630433FC';
const PROMPTPAY_EWALLET =
  '00020101021129390016A000000677010111031514000000000061453037645802TH63042D0B';
const PROMPTPAY_WITH_AMOUNT =
  '00020101021229370016A0000006770101110113006681234567853037645406100.005802TH6304F142';
const PROMPTPAY_BILL_PAYMENT =
  '00020101021129370016A0000006770101120113006681234567853037645802TH63042B61';
/** QR из банка с именем получателя по-тайски в теге 59: три байта на знак. */
const PROMPTPAY_THAI_NAME =
  '00020101021129370016A0000006770101110113006681234567853037645802TH5905สมชาย630470D1';

describe('parsePromptPay', () => {
  it('читает телефон: тринадцать знаков с кодом страны', () => {
    expect(parsePromptPay(PROMPTPAY_PHONE)).toEqual({
      ok: true,
      idType: 'phone',
      id: '0066812345678',
    });
  });

  it('читает ID-карту', () => {
    expect(parsePromptPay(PROMPTPAY_NATIONAL_ID)).toEqual({
      ok: true,
      idType: 'national_id',
      id: '1234567890123',
    });
  });

  it('читает кошелёк: пятнадцать знаков, как в примере владельца', () => {
    expect(parsePromptPay(PROMPTPAY_EWALLET)).toEqual({
      ok: true,
      idType: 'ewallet',
      id: '140000000000614',
    });
  });

  it('контрольную сумму принимает в любом регистре', () => {
    expect(parsePromptPay(PROMPTPAY_PHONE.slice(0, -4) + '823e').ok).toBe(true);
  });

  it('считает контрольную сумму по байтам: тайское имя в QR из банка', () => {
    // По знакам строки сумма вышла бы 9717, и настоящий QR отвергался бы.
    expect(parsePromptPay(PROMPTPAY_THAI_NAME)).toEqual({
      ok: true,
      idType: 'phone',
      id: '0066812345678',
    });
  });

  it('отвергает QR с зашитой суммой — словами про сумму', () => {
    const parsed = parsePromptPay(PROMPTPAY_WITH_AMOUNT);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.complaint).toMatch(/сумм/);
  });

  it('отвергает QR другого приложения: оплата счёта — не перевод', () => {
    expect(parsePromptPay(PROMPTPAY_BILL_PAYMENT).ok).toBe(false);
  });

  it('отвергает битую контрольную сумму: QR прочитан не целиком', () => {
    expect(parsePromptPay(PROMPTPAY_PHONE.slice(0, -4) + '0000').ok).toBe(false);
  });

  it('отвергает чужой стандарт и пустоту', () => {
    expect(parsePromptPay('https://qr.alipay.com/fkx12345abcd').ok).toBe(false);
    expect(parsePromptPay('').ok).toBe(false);
    expect(parsePromptPay('0002').ok).toBe(false);
  });
});

describe('looksLikeAlipayQr', () => {
  it('принимает ссылку на приём Alipay в любом регистре', () => {
    expect(looksLikeAlipayQr('https://qr.alipay.com/fkx12345abcd')).toBe(true);
    // QR часто набран прописными — так его читает сканер.
    expect(looksLikeAlipayQr('HTTPS://QR.ALIPAY.COM/FKX12345ABCD')).toBe(true);
  });

  it('отвергает чужие ссылки и не ссылки', () => {
    expect(looksLikeAlipayQr('https://example.com/fkx12345abcd')).toBe(false);
    expect(looksLikeAlipayQr('https://alipay.com.example.net/x')).toBe(false);
    expect(looksLikeAlipayQr(PROMPTPAY_PHONE)).toBe(false);
    expect(looksLikeAlipayQr('')).toBe(false);
  });
});

describe('looksLikeAlipayAccount', () => {
  it('принимает телефон в записи владельца и e-mail', () => {
    expect(looksLikeAlipayAccount('7-9536656387')).toBe(true);
    expect(looksLikeAlipayAccount('+86 138 0013 8000')).toBe(true);
    expect(looksLikeAlipayAccount('radmir@example.com')).toBe(true);
  });

  it('отвергает недописанный e-mail и просто слово', () => {
    expect(looksLikeAlipayAccount('radmir@')).toBe(false);
    expect(looksLikeAlipayAccount('radmir')).toBe(false);
    expect(looksLikeAlipayAccount('')).toBe(false);
  });
});

describe('looksLikeHolderName', () => {
  it('принимает имя латиницей, как его показывает приложение получателя', () => {
    expect(looksLikeHolderName('IAKHIN RADMIR')).toBe(true);
    expect(looksLikeHolderName('Aleksei Plotnikov')).toBe(true);
  });

  it('отвергает пустоту и неправдоподобную длину', () => {
    expect(looksLikeHolderName('')).toBe(false);
    expect(looksLikeHolderName('   ')).toBe(false);
    expect(looksLikeHolderName('A'.repeat(101))).toBe(false);
  });

  it('отвергает кириллицу: приложение получателя пишет имя латиницей', () => {
    expect(looksLikeHolderName('Яхин Радмир')).toBe(false);
  });

  it('не мешает тайскому и китайскому письму: у местного имя своё', () => {
    expect(looksLikeHolderName('สมชาย')).toBe(true);
    expect(looksLikeHolderName('王伟')).toBe(true);
  });
});

describe('хвосты QR', () => {
  it('у PromptPay — три знака, как маска в самом кошельке', () => {
    expect(promptPayHint('140000000000614')).toBe('…614');
  });

  it('у Alipay — четыре знака кода ссылки, без параметров и косой черты', () => {
    expect(alipayQrHint('https://qr.alipay.com/fkx12345abcd')).toBe('…abcd');
    expect(alipayQrHint('https://qr.alipay.com/fkx12345abcd/?t=1')).toBe('…abcd');
    expect(alipayQrHint('HTTPS://QR.ALIPAY.COM/FKX12345ABCD')).toBe('…ABCD');
  });
});
