import { describe, expect, it } from 'vitest';
import { Money } from '@nemo/types';
import { humanAmount, renderNotification, type Notification } from './notifications';

/*
 * Уведомление сотруднику читается с телефона между двумя делами, и
 * отвечает оно на три вопроса по порядку: что случилось, с кем и что
 * именно написано. Здесь закреплено, что каждый вопрос стоит своей
 * строкой и набран своей разметкой — голым текстом в три одинаковые
 * строки это уже уходило, и менеджер не понял, куда идти.
 */
describe('renderNotification: сотруднику', () => {
  const escalation: Notification = {
    kind: 'staff-escalation',
    to: 1n,
    clientId: 379336096n,
    clientUsername: 'elfuertue',
    reason: 'клиент просит менеджера',
    preview: 'нужен менеджер',
  };

  it('заголовок жирным, клиент ссылкой, его слова цитатой, тема хэштегом', () => {
    expect(renderNotification(escalation)).toEqual({
      parseMode: 'HTML',
      text: [
        '<b>Клиент просит менеджера</b>',
        '<a href="https://t.me/elfuertue">@elfuertue</a> · ID 379336096',
        '<blockquote>нужен менеджер</blockquote>',
        '#поддержка',
      ].join('\n'),
    });
  });

  it('без ника называет клиента идентификатором и ссылки не ставит', () => {
    const { text } = renderNotification({ ...escalation, clientUsername: null });
    expect(text).toContain('\nID 379336096\n');
    expect(text).not.toContain('t.me');
  });

  /*
   * Слова клиента — чужой набор. Знак «меньше» в них Telegram прочитал
   * бы как начало тега и отверг бы сообщение целиком: менеджер не
   * получил бы ничего, а клиент ждал бы ответа на вопрос, который
   * никто не увидел.
   */
  it('экранирует написанное клиентом', () => {
    const { text } = renderNotification({
      ...escalation,
      clientUsername: 'a<b',
      preview: 'курс <b>5</b> & точка',
    });
    expect(text).toContain('<blockquote>курс &lt;b&gt;5&lt;/b&gt; &amp; точка</blockquote>');
    expect(text).toContain('>@a&lt;b</a>');
  });

  it('новое обращение — тема «поддержка»', () => {
    const { text, parseMode } = renderNotification({
      kind: 'staff-client-message',
      to: 1n,
      clientId: 2n,
      clientUsername: 'ivan',
      topic: null,
      preview: 'Подскажите, сколько идут баты',
    });
    expect(parseMode).toBe('HTML');
    expect(text).toBe(
      '<b>Новое обращение</b>\n' +
        '<a href="https://t.me/ivan">@ivan</a> · ID 2\n' +
        '<blockquote>Подскажите, сколько идут баты</blockquote>\n' +
        '#поддержка',
    );
  });

  /*
   * Просьба из раздела «За границей» — про деньги, и заголовок говорит
   * это раньше цитаты: «оплатите отель» среди «а какой курс» иначе
   * терялось. Тема своя: по хэштегу менеджер находит все просьбы об
   * оплате, не открывая каждое обращение.
   */
  it('просьба об оплате названа в заголовке и помечена темой «оплата»', () => {
    const { text } = renderNotification({
      kind: 'staff-client-message',
      to: 1n,
      clientId: 2n,
      clientUsername: 'ivan',
      topic: 'hotel',
      preview: 'Оплата отеля. Hilton, Бангкок, 12–15 марта',
    });
    expect(text.startsWith('<b>Просьба оплатить отель</b>\n')).toBe(true);
    expect(text.endsWith('\n#оплата')).toBe(true);
  });

  const client = '<a href="https://t.me/ivan">@ivan</a> · ID 2';
  const base = { kind: 'staff-new-request', to: 1n, clientId: 2n, clientUsername: 'ivan' } as const;

  /*
   * Менеджер решает по уведомлению, бросать ли то, чем занят, и для
   * этого ему нужны обе суммы, курс и куда клиент получит деньги — то
   * же, что он прочитал бы в карточке. До 4 сентября 2026 уходила одна
   * сумма и пара кодов, и за деталями шли в панель.
   */
  it('заявка на обмен: обе суммы, курс, способ получения, тема «обмен»', () => {
    expect(
      renderNotification({
        ...base,
        request: {
          kind: 'exchange',
          id: 'r',
          fromAmount: Money.toAmount('10000'),
          fromCode: 'USDT',
          toCode: 'RUB',
          isCash: false,
          toAmount: Money.toAmount('866200'),
          rate: Money.toAmount('86.62'),
          payout: { kind: 'card', bankName: 'Сбербанк', network: null },
        },
      }).text,
    ).toBe(
      [
        '<b>Новая заявка на обмен</b>',
        '10\u00a0000 USDT → 866\u00a0200 RUB',
        'Курс 86,62 RUB за 1 USDT · перевод',
        'Получение: карта · Сбербанк',
        client,
        '#обмен',
      ].join('\n'),
    );
  });

  it('наличная заявка: курса нет, и это сказано прямо', () => {
    expect(
      renderNotification({
        ...base,
        request: {
          kind: 'exchange',
          id: 'r',
          fromAmount: Money.toAmount('100'),
          fromCode: 'USDT',
          toCode: 'RUB',
          isCash: true,
          toAmount: null,
          rate: null,
          payout: null,
        },
      }).text,
    ).toBe(
      ['<b>Новая заявка на обмен</b>', '100 USDT → RUB наличными', 'Курс назовёт менеджер', client, '#обмен'].join(
        '\n',
      ),
    );
  });

  it('курс читается крупной стороной: у RUB → USDT называется рубль за доллар', () => {
    const { text } = renderNotification({
      ...base,
      request: {
        kind: 'exchange',
        id: 'r',
        fromAmount: Money.toAmount('86620'),
        fromCode: 'RUB',
        toCode: 'USDT',
        isCash: false,
        toAmount: Money.toAmount('1000'),
        rate: Money.toAmount('0.0115'),
        payout: { kind: 'wallet', bankName: null, network: 'TRC20' },
      },
    });
    // 1 / 0,0115 = 86,956…, и перевёрнутый курс округляется вверх.
    expect(text).toContain('Курс 86,96 RUB за 1 USDT · перевод');
    expect(text).toContain('Получение: кошелёк · TRC20');
  });

  it('заявка на вывод: сумма, способ выплаты, тема «вывод»', () => {
    expect(
      renderNotification({
        ...base,
        request: {
          kind: 'withdrawal',
          id: 'w',
          amount: Money.toAmount('1500'),
          method: 'bank',
          payout: { kind: 'phone', bankName: 'Сбербанк', network: null },
        },
      }).text,
    ).toBe(
      ['<b>Новая заявка на вывод баллов</b>', '1\u00a0500 баллов', 'Выплата: телефон · Сбербанк', client, '#вывод'].join(
        '\n',
      ),
    );

    expect(
      renderNotification({
        ...base,
        request: { kind: 'withdrawal', id: 'w', amount: Money.toAmount('500'), method: 'crypto', payout: null },
      }).text,
    ).toContain('\nВыплата: криптовалюта\n');
  });

  it('заявка на карту: сказать нечего, кроме темы', () => {
    expect(renderNotification({ ...base, request: { kind: 'card', id: 'c' } }).text).toBe(
      `<b>Новая заявка на карту</b>\n${client}\n#карта`,
    );
  });

  it('банк и сеть — чужой набор, и экранируются', () => {
    const { text } = renderNotification({
      ...base,
      request: {
        kind: 'withdrawal',
        id: 'w',
        amount: Money.toAmount('5'),
        method: 'bank',
        payout: { kind: 'card', bankName: 'Т<Банк>', network: null },
      },
    });
    expect(text).toContain('карта · Т&lt;Банк&gt;');
  });

  it('забытая заявка: сколько ждёт в заголовке, какая — строкой, тема с напоминанием', () => {
    const stale: Notification = {
      kind: 'staff-stale-request',
      to: 1n,
      clientId: 2n,
      clientUsername: null,
      request: {
        kind: 'exchange',
        id: 'r',
        fromAmount: Money.toAmount('100'),
        fromCode: 'USDT',
        toCode: 'THB',
        isCash: false,
        toAmount: Money.toAmount('3267'),
        rate: Money.toAmount('32.67'),
        payout: null,
      },
      waitingMinutes: 45,
    };
    expect(renderNotification(stale).text).toBe(
      '<b>Заявку никто не взял 45 мин</b>\nОбмен: 100 USDT → 3\u00a0267 THB\nID 2\n#обмен #напоминание',
    );
    expect(renderNotification({ ...stale, waitingMinutes: 214 }).text).toContain(
      '<b>Заявку никто не взял больше 3 ч</b>',
    );
  });

  it('ждущий клиент', () => {
    expect(
      renderNotification({
        kind: 'staff-waiting-client',
        to: 1n,
        clientId: 2n,
        clientUsername: 'ivan',
        preview: 'Ау',
        waitingMinutes: 30,
      }).text,
    ).toBe(
      '<b>Клиент ждёт ответа 30 мин</b>\n' +
        '<a href="https://t.me/ivan">@ivan</a> · ID 2\n' +
        '<blockquote>Ау</blockquote>\n' +
        '#поддержка #напоминание',
    );
  });
});

/*
 * Число для человека: разряды разбиты неразрывным пробелом, дробная
 * часть через запятую и без хвоста нулей. Строка «10000 USDT» в
 * уведомлении читалась как «1000» — ошибка в порядке величины там, где
 * по ней решают, бросать ли дело.
 */
describe('humanAmount', () => {
  it('разбивает разряды и убирает хвост нулей', () => {
    expect(humanAmount(Money.toAmount('10000'))).toBe('10\u00a0000');
    expect(humanAmount(Money.toAmount('866200.50'))).toBe('866\u00a0200,5');
    expect(humanAmount(Money.toAmount('0.011544'))).toBe('0,011544');
    expect(humanAmount(Money.toAmount('999'))).toBe('999');
  });
});

/*
 * Клиенту текст уходит голым, и это не недоделка: выделять в нём
 * нечего, а слова менеджера с знаком «меньше» под разметкой не ушли бы
 * вовсе. Разметка объявляется рядом с текстом — отправитель её не
 * выбирает, и новый вид уведомления не может уйти с тегами в голом
 * тексте или голым текстом под разметкой.
 */
describe('renderNotification: клиенту', () => {
  /*
   * Слова менеджера без разметки, но с подписью «[Оператор]:» впереди:
   * в одном чате с клиентом говорят бот, помощник и человек, и без
   * подписи ответ человека читается как ещё одно сообщение автомата.
   * Подпись — часть доставки, а не текста: в панели она не хранится и
   * не показывается, там автора называет имя.
   */
  it('без разметки, слова менеджера как есть — за подписью оператора', () => {
    expect(renderNotification({ kind: 'manager-message', to: 1n, body: 'a < b & c' })).toEqual({
      text: '[Оператор]: a < b & c',
    });
    expect(renderNotification({ kind: 'client-message-received', to: 1n })).not.toHaveProperty(
      'parseMode',
    );
  });
});

/*
 * Вложение — своей строкой после слов клиента: «вот чек» без имени файла
 * не говорит, что чек уже пришёл. Клиенту о файле сверх предела
 * говорится готовым текстом — без чисел, кроме самого предела.
 */
describe('renderNotification: вложение', () => {
  it('сотруднику — отдельной строкой после цитаты', () => {
    expect(
      renderNotification({
        kind: 'staff-client-message',
        to: 1n,
        clientId: 2n,
        clientUsername: 'ivan',
        topic: null,
        preview: 'вот чек',
        attachment: 'файл чек <март>.pdf (240 КБ)',
      }).text,
    ).toBe(
      '<b>Новое обращение</b>\n' +
        '<a href="https://t.me/ivan">@ivan</a> · ID 2\n' +
        '<blockquote>вот чек</blockquote>\n' +
        'Вложение: файл чек &lt;март&gt;.pdf (240 КБ)\n' +
        '#поддержка',
    );
  });

  it('клиенту — что файл больше предела и что сделать вместо', () => {
    const { text, parseMode } = renderNotification({
      kind: 'client-attachment-too-large',
      to: 1n,
    });

    expect(parseMode).toBeUndefined();
    expect(text).toContain('20 МБ');
    expect(text).toMatch(/снимк|скриншот/i);
  });
});
