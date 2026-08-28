import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeRequisites as coreDescribeRequisites } from '@nemo/core';
import {
  describeRequisites,
  formatAmount,
  formatDay,
  formatMonth,
  formatRate,
  formatRateValue,
  normalizeTyped,
  parseAmount,
} from './format';

/**
 * Суммы приходят десятичными строками произвольной точности, и путь
 * «строка из базы → экран → строка на сервер» проходит без `Number`.
 * Проверяется именно он: потерянный на этом пути знак — это потерянные
 * деньги.
 */

/** Тот же разделитель разрядов, что и в самом форматировании. */
const NBSP = ' ';

describe('formatAmount', () => {
  it('разделяет разряды', () => {
    expect(formatAmount('50000')).toBe(`50${NBSP}000`);
    expect(formatAmount('1234567')).toBe(`1${NBSP}234${NBSP}567`);
    expect(formatAmount('999')).toBe('999');
  });

  it('убирает хвост нулей, которым база дополняет numeric(38, 18)', () => {
    expect(formatAmount('100.000000000000000000')).toBe('100');
    expect(formatAmount('0.010624000000000000')).toBe('0,010624');
  });

  it('не показывает больше восьми знаков после запятой', () => {
    expect(formatAmount('0.123456789123')).toBe('0,12345678');
  });

  it('показывает знак минуса, а не дефис', () => {
    expect(formatAmount('-5000')).toBe(`−5${NBSP}000`);
  });

  it('не портит точность на числах, которых не выдерживает double', () => {
    expect(formatAmount('9007199254740993')).toBe(`9${NBSP}007${NBSP}199${NBSP}254${NBSP}740${NBSP}993`);
  });
});

describe('formatRateValue', () => {
  it('целый курс не удлиняет нулями', () => {
    expect(formatRateValue('82')).toBe('82');
  });

  it('крупный курс ставит разряды', () => {
    expect(formatRateValue('5224938')).toBe(`5${NBSP}224${NBSP}938`);
  });

  /*
   * Курс приходит из ядра округлённым до сотых, и показ ничего не
   * переокругляет: 82,66 читается как 82,66. Дробный хвост длиннее
   * сотых попадает сюда только из старых заявок, поданных до округления,
   * — их карточки открывают и сегодня, и отбрасывается он вниз: 82,666,
   * показанные как 82,67, обещали бы клиенту копейку, которой сделка
   * не даёт.
   */
  it('сотые показывает как есть, лишнее отбрасывает вниз', () => {
    expect(formatRateValue('82.66')).toBe('82,66');
    expect(formatRateValue('82.6612')).toBe('82,66');
    expect(formatRateValue('82.4')).toBe('82,4');
    expect(formatRateValue('83.79')).toBe('83,79');
  });

  /*
   * У пары USDT → EUR курс 0,847 читается перевёрнутым — «1,19 USDT за
   * 1 EUR»: сотая вверх, в пользу сервиса.
   */
  it('перевёрнутый курс около единицы поднимает вверх до сотых', () => {
    expect(formatRateValue('0.847')).toBe('1,19');
  });

  it('мелкую сторону пары переворачивает: ею никто не пользуется', () => {
    // 1 / 82 — таким курс лежит у направления «рубли → USDT».
    expect(formatRateValue('0.012195121951219512')).toBe('82');
  });

  it('нулевой курс из старой заявки не роняет экран делением', () => {
    expect(formatRateValue('0')).toBe('0');
  });

  it('переворот не оставляет хвоста от деления', () => {
    // Обратное деление даёт 81,999…, и вниз это дало бы 81.
    expect(formatRateValue('0.0121951219512195')).toBe('82');
  });
});

describe('formatRate', () => {
  it('читается как табло обменника, куда бы ни шёл обмен', () => {
    expect(formatRate('82', 'USDT', 'RUB')).toBe('82 RUB за 1 USDT');
    expect(formatRate('0.012195121951219512', 'RUB', 'USDT')).toBe('82 RUB за 1 USDT');
  });

  it('покупку монеты называет с копейками, как ядро её посчитало', () => {
    // 1/87,25 — так ядро хранит курс покупки по письму владельца.
    expect(formatRate('0.011461318051575931', 'RUB', 'USDT')).toBe('87,25 RUB за 1 USDT');
  });

  /*
   * Пара, у которой обе стороны около единицы: переворот подписывает
   * её верной парой, а число называется до сотых вверх.
   */
  it('переворачивает пару около единицы вместе с подписью', () => {
    expect(formatRate('0.847', 'USDT', 'EUR')).toBe('1,19 USDT за 1 EUR');
  });
});

describe('parseAmount', () => {
  it('возвращает то, что примет сервер', () => {
    expect(parseAmount(`50${NBSP}000`)).toBe('50000');
    expect(parseAmount(`50${NBSP}000,5`)).toBe('50000.5');
  });
});

describe('normalizeTyped', () => {
  it('расставляет разряды в набранном числе', () => {
    expect(normalizeTyped('50000')).toBe(`50${NBSP}000`);
    expect(normalizeTyped('1000,25')).toBe(`1${NBSP}000,25`);
  });

  it('принимает запятую, за которой ещё ничего не набрано', () => {
    expect(normalizeTyped('1000,')).toBe(`1${NBSP}000`);
  });

  it('не подменяет опечатку нулём: человек хотел набрать что-то своё', () => {
    expect(normalizeTyped('abc')).toBe('abc');
    expect(normalizeTyped('1.2.3')).toBe('1.2.3');
    expect(normalizeTyped('')).toBe('');
  });
});

/**
 * Подписи дней в ленте истории. Считаются от полуночи, а не вычитанием
 * суток из «сейчас»: заявка, поданная сегодня в час ночи, вчерашней не
 * становится оттого, что смотрят на неё в полдень.
 */
describe('formatDay', () => {
  /*
   * Часы остановлены: подпись считается от полуночи по «сейчас», и
   * прогон, попавший на смену суток, увидел бы «Вчера» там, где секунду
   * назад было «Сегодня». Такой тест падает раз в тысячу прогонов и
   * ровно ночью — то есть тогда, когда разбираться с ним некому.
   */
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 5, 14, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('называет сегодняшнее словом', () => {
    expect(formatDay(new Date(2026, 7, 5, 9, 15))).toBe('Сегодня');
  });

  it('называет вчерашнее словом, в котором бы час оно ни было', () => {
    // Минута до полуночи — уже вчера, и час после начала тех суток тоже.
    expect(formatDay(new Date(2026, 7, 4, 23, 59))).toBe('Вчера');
    expect(formatDay(new Date(2026, 7, 4, 1, 0))).toBe('Вчера');
  });

  it('дальше вчерашнего называет датой', () => {
    expect(formatDay(new Date(2026, 7, 1, 12, 0))).toBe('1 августа');
  });

  it('переживает то, что датой не является', () => {
    expect(formatDay('не дата')).toBe('');
  });
});

describe('formatMonth', () => {
  /*
   * Родительный падеж, а не именительный: подпись стоит в предложении
   * «с марта 2026», и «с март 2026» там читается как опечатка.
   */
  it('называет месяц и год так, как это стоит в строке «с …»', () => {
    expect(formatMonth(new Date(2026, 2, 14))).toBe('марта 2026');
    expect(formatMonth(new Date(2026, 7, 1))).toBe('августа 2026');
  });

  it('переживает то, что датой не является', () => {
    expect(formatMonth('не дата')).toBe('');
  });
});

/*
 * Подпись записи — копия той, что в ядре: ядро тянет драйвер базы и в
 * браузер не идёт. Копии обязаны совпадать — один реквизит в приложении
 * и в панели должен называться одинаково, — и совпадение здесь
 * закреплено на всех семи родах, а не проверяется глазами.
 */
describe('describeRequisites', () => {
  const empty = {
    bankName: null,
    phone: null,
    cardLast4: null,
    network: null,
    addressHint: null,
    accountLast4: null,
    qrHint: null,
    promptpayIdType: null,
    alipayAccount: null,
  };
  const records = [
    { ...empty, kind: 'phone' as const, bankName: 'Сбербанк', phone: '+79990000000' },
    { ...empty, kind: 'card' as const, bankName: 'Тинькофф', cardLast4: '5679' },
    { ...empty, kind: 'wallet' as const, network: 'TRC20', addressHint: 'TQmX…aU6e' },
    { ...empty, kind: 'account' as const, bankName: 'Kasikornbank', accountLast4: '6658' },
    { ...empty, kind: 'promptpay' as const, qrHint: '…614', promptpayIdType: 'ewallet' as const },
    { ...empty, kind: 'alipay' as const, alipayAccount: '7-9536656387' },
    { ...empty, kind: 'alipay_qr' as const, qrHint: '…abcd' },
  ];

  it('называет запись так, как её узнаёт клиент', () => {
    expect(records.map(describeRequisites)).toEqual([
      'Сбербанк · +79990000000',
      'Тинькофф · карта •••• 5679',
      'TRC20 · TQmX…aU6e',
      'Kasikornbank · счёт •••• 6658',
      'PromptPay · кошелёк …614',
      'Alipay · 7-9536656387',
      'Alipay · QR …abcd',
    ]);
  });

  it('совпадает с подписью ядра на каждом роде', () => {
    for (const record of records) {
      expect(describeRequisites(record)).toBe(coreDescribeRequisites(record));
    }
  });
});
