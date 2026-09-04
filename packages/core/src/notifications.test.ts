import { describe, expect, it } from 'vitest';
import { Money } from '@nemo/types';
import { renderNotification, type Notification } from './notifications';

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

  it('заголовок жирным, клиент ссылкой, его слова цитатой', () => {
    expect(renderNotification(escalation)).toEqual({
      parseMode: 'HTML',
      text: [
        '<b>Клиент просит менеджера</b>',
        '<a href="https://t.me/elfuertue">@elfuertue</a> · ID 379336096',
        '<blockquote>нужен менеджер</blockquote>',
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

  it('новое обращение', () => {
    const { text, parseMode } = renderNotification({
      kind: 'staff-client-message',
      to: 1n,
      clientId: 2n,
      clientUsername: 'ivan',
      preview: 'Подскажите, сколько идут баты',
    });
    expect(parseMode).toBe('HTML');
    expect(text).toBe(
      '<b>Новое обращение</b>\n' +
        '<a href="https://t.me/ivan">@ivan</a> · ID 2\n' +
        '<blockquote>Подскажите, сколько идут баты</blockquote>',
    );
  });

  it('новая заявка: что за заявка в заголовке, сумма строкой ниже', () => {
    const base = { kind: 'staff-new-request', to: 1n, clientId: 2n, clientUsername: 'ivan' } as const;
    const client = '<a href="https://t.me/ivan">@ivan</a> · ID 2';

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
        },
      }).text,
    ).toBe(`<b>Новая заявка на обмен</b>\n100 USDT → RUB, наличными\n${client}`);

    expect(
      renderNotification({
        ...base,
        request: { kind: 'withdrawal', id: 'w', amount: Money.toAmount('500') },
      }).text,
    ).toBe(`<b>Новая заявка на вывод</b>\n500 баллов\n${client}`);

    expect(renderNotification({ ...base, request: { kind: 'card', id: 'c' } }).text).toBe(
      `<b>Новая заявка на карту</b>\n${client}`,
    );
  });

  it('забытая заявка: сколько ждёт в заголовке, какая — строкой', () => {
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
      },
      waitingMinutes: 45,
    };
    expect(renderNotification(stale).text).toBe(
      '<b>Заявку никто не взял 45 мин</b>\nЗаявка на обмен: 100 USDT → THB\nID 2',
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
        '<blockquote>Ау</blockquote>',
    );
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
