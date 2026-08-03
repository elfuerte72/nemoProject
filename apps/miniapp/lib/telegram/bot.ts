import { Bot, InlineKeyboard, type Context } from 'grammy';
import { Money } from '@nemo/types';
import { renderNotification } from '@nemo/core';
import { getCore } from '@/lib/core';
import { formatRateValue } from '@/lib/format';
import { referralLink } from '@/lib/referral';

/**
 * Бот — точка входа, главное меню и канал уведомлений.
 *
 * Продуктовые экраны живут в Mini App (docs/adr/0001), и данные бот
 * показывает ровно в одном месте — курсом по кнопке. Граница сдвинута
 * сознательно: ради одной цифры приложение никто открывать не станет.
 *
 * Главное меню — кнопки в самом сообщении, а не постоянная клавиатура
 * под полем ввода. Причина не в оформлении: кнопке постоянной
 * клавиатуры Telegram не передаёт данные запуска
 * (https://core.telegram.org/bots/webapps), и открытое ею приложение не
 * знает, кто пришёл, — клиент видел «Откройте приложение из Telegram».
 * Инлайновая кнопка их передаёт, и сообщение с меню остаётся рабочим в
 * переписке: его кнопки нажимаются и через неделю.
 *
 * Позвать меню заново можно командой `/menu` — она стоит первой в
 * списке у кнопки рядом с полем ввода. Обменника в самой кнопке нет:
 * главное меню одно, и второй вход в приложение мимо него разошёлся бы
 * с ним при первой же правке.
 *
 * Тексты берутся из заготовок, которые администратор правит из панели;
 * значения по умолчанию лежат в коде, и пустой справочник ничего не
 * ломает.
 */

/** Подписи кнопок меню. Ими же приходят сообщения от клиента. */
const MENU = {
  app: 'Открыть обменник',
  rates: 'Курс',
  referral: 'Реферальная ссылка',
  support: 'Поддержка',
} as const;

/**
 * Чем помечено нажатие кнопки меню. Значения короткие и неизменные: они
 * лежат в уже отправленных сообщениях, и переименование сломало бы
 * кнопки во всей прошлой переписке.
 */
const ACTION = {
  rates: 'rates',
  referral: 'referral',
  support: 'support',
} as const;

/**
 * Ответ по существу заодно снимает постоянную клавиатуру: у клиента,
 * запускавшего бота до переезда меню в сообщение, она осталась
 * раскрытой, а её кнопка обменника открывала приложение без данных
 * запуска. Тому, у кого клавиатуры нет, это ничего не делает.
 */
const WITHOUT_OLD_KEYBOARD = { reply_markup: { remove_keyboard: true } } as const;

let instance: Bot | undefined;

export function getBot(): Bot {
  if (instance) return instance;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('Не задан TELEGRAM_BOT_TOKEN');
  }
  const appUrl = process.env.MINIAPP_URL;
  if (!appUrl) {
    throw new Error('Не задан MINIAPP_URL');
  }

  const bot = new Bot(token);

  /**
   * Главное меню — кнопки под приветствием. Обменник первой строкой: на
   * него приходится большинство нажатий, а остальные три кнопки
   * отвечают в этом же чате.
   */
  const menu = new InlineKeyboard()
    .webApp(MENU.app, appUrl)
    .row()
    .text(MENU.rates, ACTION.rates)
    .text(MENU.referral, ACTION.referral)
    .row()
    .text(MENU.support, ACTION.support);

  async function greet(ctx: Context): Promise<void> {
    // Реферальный код едет в Mini App параметром `startapp` ссылки, а не
    // через эту команду: привязка выполняется там, где
    // `telegram_user_id` подтверждён подписью initData. Здесь он ничем
    // не подтверждён.
    await ctx.reply(await getCore().getTextTemplate('bot_greeting'), {
      reply_markup: menu,
    });
  }

  async function support(ctx: Context): Promise<void> {
    await ctx.reply(await getCore().getTextTemplate('bot_support'), WITHOUT_OLD_KEYBOARD);
  }

  bot.command('start', greet);
  // Меню отдельной командой: сообщение с кнопками уходит вверх
  // переписки, и звать его перезапуском бота — не то, чего клиент ждёт
  // от `/start`.
  bot.command('menu', greet);

  bot.command('rates', showRates);
  bot.command('referral', sendReferralLink);
  bot.command('support', support);

  /*
   * Нажатие кнопки меню. Telegram ждёт подтверждения приёма, иначе у
   * клиента на кнопке крутятся часы: отвечаем сразу, до похода за
   * курсом или в базу.
   */
  bot.callbackQuery(ACTION.rates, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showRates(ctx);
  });
  bot.callbackQuery(ACTION.referral, async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendReferralLink(ctx);
  });
  bot.callbackQuery(ACTION.support, async (ctx) => {
    await ctx.answerCallbackQuery();
    await support(ctx);
  });

  /*
   * Подписи кнопок старой постоянной клавиатуры. У тех, кто запускал
   * бота до переезда меню в сообщение, она осталась раскрытой, и до
   * первого ответа бота её нажатия приходят обычным текстом — иначе
   * вопрос про курс ушёл бы менеджеру.
   */
  bot.hears(MENU.rates, showRates);
  bot.hears(MENU.referral, sendReferralLink);
  bot.hears(MENU.support, support);

  /*
   * Всё остальное — обращение к менеджеру. Шаблонного автоответа здесь
   * нет: подтверждение приёма возвращает операция, и только на первое
   * сообщение череды — иначе разговор выглядит перепиской с
   * автоответчиком.
   */
  bot.on('message:text', (ctx) => receive(ctx, { body: ctx.message.text }));

  bot.on('message:photo', (ctx) => {
    // Берётся самый крупный размер: Telegram присылает лесенку, и
    // менеджеру нужен тот, на котором видно сумму перевода.
    const largest = ctx.message.photo.at(-1);
    return receive(ctx, {
      ...(ctx.message.caption === undefined ? {} : { body: ctx.message.caption }),
      ...(largest === undefined ? {} : { attachmentFileId: largest.file_id }),
    });
  });

  /*
   * Отказ ядра — не повод оставить клиента без ответа и не повод
   * отвечать Telegram ошибкой: он повторит обновление, и клиент получит
   * то же самое ещё раз. Ошибка пишется в журнал, клиент видит, что его
   * услышали.
   */
  bot.catch(async ({ ctx, error }) => {
    console.error('Бот не смог ответить:', error);
    // Часы на нажатой кнопке гасятся первыми: пока Telegram не получил
    // подтверждения, клиент видит не отказ, а зависшее меню.
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch(() => undefined);
    }
    await ctx
      .reply(
        'Не получилось ответить прямо сейчас. Попробуйте ещё раз через минуту.',
        WITHOUT_OLD_KEYBOARD,
      )
      .catch(() => undefined);
  });

  instance = bot;
  return bot;
}

/**
 * Обращение клиента: сохранить и подтвердить приём.
 *
 * Само сообщение не пересылается сотрудникам отсюда: их уведомляет бот
 * входа в админку, чей токен лежит только в деплое панели
 * (docs/adr/0005). Клиентское приложение до него не дотягивается — и не
 * должно.
 */
async function receive(
  ctx: Context,
  content: { body?: string; attachmentFileId?: string },
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (telegramUserId === undefined) return;

  const { notifications } = await getCore().receiveClientMessage({
    telegramUserId: BigInt(telegramUserId),
    ...content,
    ...(ctx.from?.username === undefined ? {} : { username: ctx.from.username }),
  });

  // Подтверждение отвечается прямо здесь, а не уходит доставкой: так оно
  // приходит тем же ответом на сообщение клиента. Пустой ответ операции
  // означает, что подтверждение уже уходило: два одинаковых сообщения
  // подряд превратили бы разговор в автоответчик.
  const acknowledgement = notifications.find(
    (one) => one.kind === 'client-message-received',
  );
  if (acknowledgement) {
    await ctx.reply(renderNotification(acknowledgement), WITHOUT_OLD_KEYBOARD);
  }
}

/**
 * Молчание источника котировок — не поломка: заявку подать можно, и курс
 * по ней назовёт менеджер. Сказать об этом честно дешевле, чем показать
 * пустое место.
 */
const RATES_UNAVAILABLE =
  'Курс сейчас недоступен: его назовёт менеджер после подачи заявки. ' +
  'Обменник работает как обычно.';

/**
 * Курс в чате — единственное место, где бот показывает данные.
 *
 * Две котировки, а не одна с обратным знаком: наценка накладывается на
 * каждое направление отдельно, и покупка с продажей не зеркальны.
 */
async function showRates(ctx: Context): Promise<void> {
  const core = getCore();
  const [sell, buy] = await Promise.all([
    core.getQuote({ fromCode: 'USDT', toCode: 'RUB' }),
    core.getQuote({ fromCode: 'RUB', toCode: 'USDT' }),
  ]);

  if (!sell && !buy) {
    await ctx.reply(RATES_UNAVAILABLE, WITHOUT_OLD_KEYBOARD);
    return;
  }

  const lines = [
    sell ? `Продаёте USDT — ${formatRateValue(sell.rate)} ₽ за 1 USDT` : undefined,
    // Котировка «рубли → USDT» приходит в USDT за рубль: числом вроде
    // 0,0098 человек не пользуется, и она переворачивается в рубли за
    // монету — так курс и читают в обменниках.
    buy && !Money.isZero(buy.rate)
      ? `Покупаете USDT — ${formatRateValue(Money.divide(Money.toAmount('1'), buy.rate))} ₽ за 1 USDT`
      : undefined,
  ].filter((line) => line !== undefined);

  if (lines.length === 0) {
    // Обе котировки пришли, но считать по ним нечего. Для клиента это то
    // же самое, что молчание источника, и сказать надо то же самое.
    await ctx.reply(RATES_UNAVAILABLE, WITHOUT_OLD_KEYBOARD);
    return;
  }

  // Кнопки под ответом не дублируются: клиент пришёл сюда из меню, оно
  // осталось на экране выше, и его кнопка обменника по-прежнему рабочая.
  await ctx.reply(
    `${lines.join('\n')}\n\nКурс с наценкой сервиса: по нему и обменяем — ` +
      'подать заявку можно в обменнике.',
    WITHOUT_OLD_KEYBOARD,
  );
}

/**
 * Реферальная ссылка сообщением: из чата её пересылают одним касанием,
 * а из Mini App только копируют и потом ищут, куда вставить.
 */
async function sendReferralLink(ctx: Context): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (telegramUserId === undefined) return;

  // Клиент мог ни разу не открыть приложение: регистрация здесь его и
  // заводит. Реферера при этом не появляется — привязка выполняется
  // только там, где `telegram_user_id` подтверждён подписью initData.
  const { client } = await getCore().registerClient({
    telegramUserId: BigInt(telegramUserId),
    // Username в Telegram меняется, и заведённый из чата клиент не
    // должен остаться без него: в панели по нему менеджер и узнаёт, с
    // кем говорит.
    ...(ctx.from?.username === undefined ? {} : { username: ctx.from.username }),
  });

  const link = referralLink(client.referralCode);
  if (!link) {
    await ctx.reply(
      'Реферальная ссылка сейчас недоступна. Напишите менеджеру — он её пришлёт.',
      WITHOUT_OLD_KEYBOARD,
    );
    return;
  }

  // Ссылка отдельной строкой и без разметки: сообщение пересылают
  // целиком, и знакомый должен увидеть её глазами, а не разбирать, где
  // в тексте нажимать.
  await ctx.reply(
    `${await getCore().getTextTemplate('bot_referral')}\n${link}`,
    WITHOUT_OLD_KEYBOARD,
  );
}
