import { Bot, InlineKeyboard } from 'grammy';

/**
 * Бот — точка входа и канал уведомлений (docs/adr/0001). Продуктовые
 * экраны живут в Mini App, поэтому здесь только `/start`, кнопка запуска
 * приложения и передача в поддержку.
 */

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

  bot.command('start', async (ctx) => {
    // Реферальная ссылка приходит как `/start ref_<telegram_user_id>`.
    // Привязка выполняется на стороне Mini App, где уже проверен initData:
    // здесь идентификатор пригласившего ничем не подтверждён.
    const keyboard = new InlineKeyboard().webApp('Открыть обменник', appUrl);
    await ctx.reply(
      'Здравствуйте. Здесь можно обменять валюту: откройте приложение, ' +
        'выберите направление и укажите сумму. Заявку возьмёт менеджер и ' +
        'проведёт обмен, а бот сообщит о каждом изменении статуса.',
      { reply_markup: keyboard },
    );
  });

  bot.on('message:text', async (ctx) => {
    // Заглушка до подключения консьержа: молча не отвечать нельзя,
    // клиент решит, что бот сломался.
    await ctx.reply(
      'Сообщение получено — им займётся менеджер. ' +
        'Чтобы подать заявку на обмен, откройте приложение командой /start.',
    );
  });

  instance = bot;
  return bot;
}
