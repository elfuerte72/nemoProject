import { describe, expect, it } from 'vitest';
import { MAX_REPLY_LENGTH, replyComplaints } from './concierge-guard.js';

/**
 * Застава перед ответом консьержа.
 *
 * Модель дешёвая, и разговор идёт про деньги: единственное, чего нельзя
 * допустить, — названное ею число, которого сервис не называл. Курс,
 * сумма и срок, взятые ею из воздуха, читаются клиентом как обещание
 * сервиса, и спорить он потом будет со скриншотом.
 *
 * Поэтому правило простое до грубости: в ответе не бывает числа,
 * которого нет в справке или в словах самого клиента. Модели об этом
 * сказано прямо, а количества ей велено писать словами — но правило
 * держится здесь, а не на её послушании.
 */

/** Справка, какую ядро кладёт в запрос: числа отсюда называть можно. */
const FACTS = 'Курс USDT → RUB: 81,25. Заявка 7 от 6 августа: в работе. Баллов: 1200.';

describe('числа', () => {
  it('пропускает те, что сервис назвал сам', () => {
    expect(
      replyComplaints({
        reply: 'Сейчас курс 81,25 за USDT. По заявке 7 менеджер уже работает.',
        sources: [FACTS],
      }),
    ).toEqual([]);
  });

  it('ловит выдуманный курс', () => {
    const complaints = replyComplaints({
      reply: 'Сейчас курс 95 рублей за USDT.',
      sources: [FACTS],
    });

    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain('95');
  });

  it('пропускает то, что назвал сам клиент: он спрашивает про свою сумму', () => {
    expect(
      replyComplaints({
        reply: 'Проверил: заявки на 5000 USDT у вас нет.',
        sources: [FACTS, 'Хочу поменять 5000 USDT'],
      }),
    ).toEqual([]);
  });

  it('не различает запятую и точку: разделитель — оформление, а не число', () => {
    expect(
      replyComplaints({ reply: 'Курс 81.25.', sources: [FACTS] }),
    ).toEqual([]);
  });

  it('не считает числом разряды, разбитые пробелом', () => {
    expect(
      replyComplaints({ reply: 'На балансе 1 200 баллов.', sources: [FACTS] }),
    ).toEqual([]);
  });

  it('пропускает ответ вовсе без чисел', () => {
    expect(
      replyComplaints({
        reply: 'Курс виден на главном экране обменника, там же и заявка.',
        sources: [FACTS],
      }),
    ).toEqual([]);
  });

  it('называет каждое выдуманное число, а не только первое', () => {
    const complaints = replyComplaints({
      reply: 'Обычно занимает 15 минут, комиссия 3 процента.',
      sources: [FACTS],
    });

    expect(complaints).toHaveLength(2);
  });
});

describe('длина', () => {
  it('ловит ответ длиннее предела: в чате его дочитывают до середины', () => {
    const complaints = replyComplaints({
      reply: 'а'.repeat(MAX_REPLY_LENGTH + 1),
      sources: [FACTS],
    });

    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain('длиннее');
  });

  it('пропускает ответ ровно в предел', () => {
    expect(
      replyComplaints({ reply: 'а'.repeat(MAX_REPLY_LENGTH), sources: [FACTS] }),
    ).toEqual([]);
  });
});

describe('пустота', () => {
  it('ловит ответ, в котором нечего читать', () => {
    expect(replyComplaints({ reply: '   ', sources: [FACTS] })).toHaveLength(1);
  });
});

describe('машинный ритм', () => {
  it('ловится тем же правилом, что и рукописные тексты', () => {
    const complaints = replyComplaints({
      reply: 'Курс — цифрой здесь, заявка — у менеджера, ответ — в этом чате.',
      sources: [FACTS],
    });

    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain('тире');
  });
});
