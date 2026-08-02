import { Bot, Keyboard, type Context } from 'grammy';
import { Money } from '@nemo/types';
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
 * Постоянная клавиатура — главное меню сервиса: она остаётся под полем
 * ввода, и нужную кнопку не приходится искать в истории переписки.
 * Приходит с каждым ответом бота, а не только с `/start`: у клиента,
 * запускавшего бота раньше, меню появится с первым же ответом — иначе
 * он остался бы с одной старой кнопкой и списком команд.
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
   * Главное меню под полем ввода. Обменник открывается прямо отсюда: на
   * эту кнопку приходится большинство нажатий, и уводить её в отдельное
   * сообщение значило бы добавлять шаг к каждому обмену.
   */
  const menu = new Keyboard()
    .webApp(MENU.app, appUrl)
    .row()
    .text(MENU.rates)
    .text(MENU.referral)
    .row()
    .text(MENU.support)
    .resized()
    .persistent();

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
    await ctx.reply(await getCore().getTextTemplate('bot_support'), {
      reply_markup: menu,
    });
  }

  bot.command('start', greet);

  bot.command('rates', (ctx) => showRates(ctx, menu));
  bot.hears(MENU.rates, (ctx) => showRates(ctx, menu));

  bot.command('referral', (ctx) => sendReferralLink(ctx, menu));
  bot.hears(MENU.referral, (ctx) => sendReferralLink(ctx, menu));

  bot.command('support', support);
  bot.hears(MENU.support, support);

  // Шаблонного автоответа на произвольный текст здесь нет: он обещал
  // клиенту менеджера, до которого сообщение не доходило. Переписка —
  // отдельная работа, и до неё молчание честнее обещания.

  /*
   * Отказ ядра — не повод оставить клиента без ответа и не повод
   * отвечать Telegram ошибкой: он повторит обновление, и клиент получит
   * то же самое ещё раз. Ошибка пишется в журнал, клиент видит, что его
   * услышали.
   */
  bot.catch(async ({ ctx, error }) => {
    console.error('Бот не смог ответить:', error);
    await ctx
      .reply('Не получилось ответить прямо сейчас. Попробуйте ещё раз через минуту.', {
        reply_markup: menu,
      })
      .catch(() => undefined);
  });

  instance = bot;
  return bot;
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
async function showRates(ctx: Context, menu: Keyboard): Promise<void> {
  const core = getCore();
  const [sell, buy] = await Promise.all([
    core.getQuote({ fromCode: 'USDT', toCode: 'RUB' }),
    core.getQuote({ fromCode: 'RUB', toCode: 'USDT' }),
  ]);

  if (!sell && !buy) {
    await ctx.reply(RATES_UNAVAILABLE, { reply_markup: menu });
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
    await ctx.reply(RATES_UNAVAILABLE, { reply_markup: menu });
    return;
  }

  // Ответ уходит с тем же меню: его первая кнопка открывает обменник и
  // стоит прямо под сообщением — отдельная кнопка под ответом дублировала
  // бы её, а клавиатура при этом не дошла бы до тех, кто спрашивает
  // только курс.
  await ctx.reply(
    `${lines.join('\n')}\n\nКурс с наценкой сервиса: по нему и обменяем — ` +
      'подать заявку можно в обменнике.',
    { reply_markup: menu },
  );
}

/**
 * Реферальная ссылка сообщением: из чата её пересылают одним касанием,
 * а из Mini App только копируют и потом ищут, куда вставить.
 */
async function sendReferralLink(ctx: Context, menu: Keyboard): Promise<void> {
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
      { reply_markup: menu },
    );
    return;
  }

  // Ссылка отдельной строкой и без разметки: сообщение пересылают
  // целиком, и знакомый должен увидеть её глазами, а не разбирать, где
  // в тексте нажимать.
  await ctx.reply(`${await getCore().getTextTemplate('bot_referral')}\n${link}`, {
    reply_markup: menu,
  });
}
