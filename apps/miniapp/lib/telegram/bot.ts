import { Bot, InlineKeyboard, type Context } from 'grammy';
import { Money } from '@nemo/types';
import {
  CONCIERGE_QUIET_MS,
  renderNotification,
  type MessageAttachmentInput,
  type RenderedNotification,
} from '@nemo/core';
import { getCore } from '@/lib/core';
import { referralLink } from '@/lib/referral';
import { nudgeStaffAlerts } from '@/lib/staff-alert';
import {
  RATES_UNAVAILABLE,
  renderRatesMessage,
  type QuotedPair,
} from './rates-message';
import { attachmentOf } from './attachments';

/**
 * Бот — точка входа, главное меню и канал уведомлений.
 *
 * Продуктовые экраны живут в Mini App (docs/adr/0001), и данные бот
 * показывает ровно в одном месте — курсом по кнопке. Граница сдвинута
 * сознательно: ради того, чтобы посмотреть курс, приложение никто
 * открывать не станет. Само сообщение с курсом собирает
 * `rates-message.ts` — здесь только сбор данных для него.
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
 * Тексты, которыми бот говорит, лежат в коде (`bot-texts.ts`): правка их
 * из панели здесь была и убрана — тексты, не проходящие ревью,
 * расходились с остальным приложением молча.
 */

/**
 * Подписи кнопок меню.
 *
 * Со значком в начале: у кнопки нет ни цвета, ни размера — отличать их
 * друг от друга приходится чтением, а значок узнаётся раньше слова.
 * Ставится он перед текстом и через пробел: Telegram кнопку не
 * форматирует, и всё выравнивание в ней — это порядок символов.
 */
const MENU = {
  app: '💱 Открыть обменник',
  rates: '📈 Курс',
  referral: '🎁 Реферальная ссылка',
  support: '🛟 Поддержка',
} as const;

/**
 * Те же подписи, какими они были на постоянной клавиатуре под полем
 * ввода. У клиента, запускавшего бота до переезда меню в сообщение, она
 * осталась раскрытой, и её нажатия приходят обычным текстом — тем
 * самым, без значков. Ловить их надо по старому написанию: сравнивать
 * со значком значит не узнать ни одного из них.
 */
const LEGACY_LABELS = {
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

/** Разметка, в которой набран текст, — параметром Bot API. */
function markupOf(rendered: RenderedNotification): { parse_mode?: 'HTML' } {
  return rendered.parseMode ? { parse_mode: rendered.parseMode } : {};
}

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
   * Главное меню — кнопки под приветствием, по одной в ряд. Обменник
   * первым: на него приходится большинство нажатий, а остальные три
   * отвечают в этом же чате.
   *
   * Столбцом, а не сеткой: Telegram делит ряд между кнопками поровну и
   * режет то, что не поместилось, — «Реферальная ссылка» в паре с
   * «Курсом» превращалась в «Реферальная ссы…». Столбец отдаёт каждой
   * кнопке всю ширину, и подписи читаются целиком, какими бы длинными
   * они ни стали дальше.
   */
  const menu = new InlineKeyboard()
    .webApp(MENU.app, appUrl)
    .row()
    .text(MENU.rates, ACTION.rates)
    .row()
    .text(MENU.referral, ACTION.referral)
    .row()
    .text(MENU.support, ACTION.support);

  async function greet(ctx: Context): Promise<void> {
    // Реферальный код едет в Mini App параметром `startapp` ссылки, а не
    // через эту команду: привязка выполняется там, где
    // `telegram_user_id` подтверждён подписью initData. Здесь он ничем
    // не подтверждён.
    await ctx.reply(getCore().getBotText('greeting'), {
      reply_markup: menu,
    });
  }

  async function support(ctx: Context): Promise<void> {
    await ctx.reply(getCore().getBotText('support'), WITHOUT_OLD_KEYBOARD);
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
   * Нажатия старой постоянной клавиатуры: до первого ответа бота они
   * приходят обычным текстом — иначе вопрос про курс ушёл бы менеджеру.
   */
  bot.hears(LEGACY_LABELS.rates, showRates);
  bot.hears(LEGACY_LABELS.referral, sendReferralLink);
  bot.hears(LEGACY_LABELS.support, support);

  /*
   * Всё остальное — обращение к менеджеру. Шаблонного автоответа здесь
   * нет: подтверждение приёма возвращает операция, и только на первое
   * сообщение череды — иначе разговор выглядит перепиской с
   * автоответчиком.
   */
  bot.on('message:text', (ctx) => receive(ctx, { body: ctx.message.text }));

  /*
   * Файл любого рода — PDF-чек, скриншот «как файл», голосовое. До
   * 4 сентября 2026 бот слушал только фото, и документ терялся молча:
   * без записи, без подтверждения, без уведомления сотрудникам.
   * Наклейку файлом не считаем — ответа на неё не ждут.
   */
  bot.on('message:file', (ctx) => {
    const attachment = attachmentOf(ctx.message);
    if (!attachment) return;
    return receive(ctx, {
      ...(ctx.message.caption === undefined ? {} : { body: ctx.message.caption }),
      attachment,
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
  content: { body?: string; attachment?: MessageAttachmentInput },
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (telegramUserId === undefined) return;

  const clientId = BigInt(telegramUserId);
  const { notifications } = await getCore().receiveClientMessage({
    telegramUserId: clientId,
    ...content,
    ...(ctx.from?.username === undefined ? {} : { username: ctx.from.username }),
  });

  /*
   * Ответы клиенту — все, что вернула операция, и в её порядке: она
   * знает, что сказать первым (файл сверх предела), а что следом
   * (подтверждение приёма). Выбирать здесь по виду значило бы молча
   * терять каждый вид, заведённый после. Отвечается прямо здесь, а не
   * уходит доставкой: так ответ приходит тем же ответом на сообщение
   * клиента.
   */
  for (const notification of notifications) {
    const rendered = renderNotification(notification);
    await ctx.reply(rendered.text, { ...WITHOUT_OLD_KEYBOARD, ...markupOf(rendered) });
  }

  // Подтверждение приёма означает, что консьерж за сообщение не взялся.
  // Его отсутствие — одно из двух: подтверждение уже уходило в этой
  // череде, либо клиент получит не подтверждение, а живой ответ.
  if (notifications.some((one) => one.kind === 'client-message-received')) {
    // Толчок ровно там же, где подтверждение: право на него занимает то
    // же условное изменение, которым обращение становится видимым
    // сотрудникам. Второе сообщение той же череды нового повода не
    // создаёт — и звать за ним панель незачем.
    nudgeStaffAlerts();
    return;
  }

  /*
   * Ответ консьержа не дожидается: обработчик возвращается сейчас, а
   * провайдер думает секунды. Дождавшись его здесь, мы дождались бы и
   * повторного обновления от Telegram — то есть второго такого же
   * ответа клиенту.
   */
  void answerAsConcierge(ctx, clientId).catch((error: unknown) => {
    // Сообщение клиента записано, и отметка «консьерж взялся» на нём
    // осталась: опрос подберёт его и ответит следом.
    console.error('Помощник не довёл ответ до конца:', error);
  });
}

/**
 * Ответ консьержа. Зовётся в фоне — см. место вызова.
 *
 * Пока идёт ожидание, клиент видит «печатает…»: молчащий чат неотличим
 * от сломанного бота, а разница в несколько секунд заметна.
 *
 * Не дошедшее подберёт опрос: у сообщения, за которое консьерж взялся и
 * не ответил, остаётся отметка, и по ней его находит
 * `/api/concierge/pending`.
 */
async function answerAsConcierge(ctx: Context, clientId: bigint): Promise<void> {
  /*
   * Пауза накопления: человек пишет мысль несколькими сообщениями, и
   * операция не возьмёт череду раньше тишины — вызов до неё работал бы
   * вхолостую. Ждём паузу с небольшим запасом; вызов, назначенный
   * последним сообщением череды, придёт уже после тишины и ответит на
   * всё разом.
   */
  await new Promise((resolve) => setTimeout(resolve, CONCIERGE_QUIET_MS + 500));

  // Часы набираются один раз: Telegram гасит их через пять секунд сам, а
  // держать их обновлением значит ждать ответа ради этого обновления.
  await ctx.replyWithChatAction('typing').catch(() => undefined);

  const { notifications, handedToHuman } = await getCore().answerAsConcierge({
    telegramUserId: clientId,
  });

  for (const notification of notifications) {
    await deliverConciergeReply(ctx, notification).catch((error: unknown) => {
      // Ответ записан в ленту, и менеджер его видит. Отказ доставки —
      // повод для журнала, а не для повтора: повтор прислал бы клиенту
      // второй такой же ответ.
      console.error('Ответ помощника не доставлен:', error);
    });
  }

  // Панель будим только на эскалации: обычный ответ повода для
  // сотрудников не создаёт, и звать её за ним — стучаться впустую на
  // каждое сообщение клиента.
  if (handedToHuman) {
    nudgeStaffAlerts();
  }
}

/**
 * Ответ консьержа: текст или картинка-подсказка с подписью.
 *
 * Картинка отдаётся доменом самого приложения — путь приходит в
 * уведомлении, адрес собирается здесь. Не собрался адрес или Telegram
 * не забрал картинку — уходит один текст: подпись написана так, что
 * работает и без снимка, а клиент без ответа не остаётся.
 */
async function deliverConciergeReply(
  ctx: Context,
  notification: Parameters<typeof renderNotification>[0],
): Promise<void> {
  const rendered = renderNotification(notification);
  const markup = markupOf(rendered);

  if (notification.kind === 'concierge-message' && notification.photoPath) {
    const base = (process.env.MINIAPP_URL ?? '').replace(/\/+$/, '');
    if (base !== '') {
      try {
        await ctx.replyWithPhoto(`${base}${notification.photoPath}`, {
          caption: rendered.text,
          ...markup,
        });
        return;
      } catch (error) {
        console.error('Картинка-подсказка не ушла, отправляю текстом:', error);
      }
    }
  }

  await ctx.reply(rendered.text, { ...WITHOUT_OLD_KEYBOARD, ...markup });
}

/**
 * Курс в чате — единственное место, где бот показывает данные.
 *
 * Собирает направления с котировками и отдаёт их вёрстке
 * (`rates-message.ts`): чем сервис торгует, знает справочник, а по какому
 * курсу — ядро. Здесь только сведение одного с другим.
 */
async function showRates(ctx: Context): Promise<void> {
  const core = getCore();
  const { pairs } = await core.getExchangeTerms();

  // Наличные через котировки не проходят вовсе: курс по ним называет
  // менеджер, и биржевого у них нет.
  const electronic = pairs.filter((pair) => pair.kind === 'electronic');

  /*
   * Все направления разом, а не по одному на нажатие: котировки лежат
   * снимками в кэше и наружу за ними никто не идёт, а клиент в этот
   * момент ждёт ответа в чате.
   */
  const quoted = (
    await Promise.all(
      electronic.map(async ({ fromCode, toCode }) => {
        const quote = await core.getQuote({ fromCode, toCode });
        // Нулевой курс — не курс: по нему нечего считать, и в столбце он
        // читался бы как «не дадут ничего».
        return quote && !Money.isZero(quote.rate)
          ? ({ fromCode, toCode, rate: quote.rate } satisfies QuotedPair)
          : undefined;
      }),
    )
  ).filter((one): one is QuotedPair => one !== undefined);

  if (quoted.length === 0) {
    // Ни одной котировки: для клиента это то же, что молчание источника.
    await ctx.reply(RATES_UNAVAILABLE, WITHOUT_OLD_KEYBOARD);
    return;
  }

  // Кнопки под ответом не дублируются: клиент пришёл сюда из меню, оно
  // осталось на экране выше, и его кнопка обменника по-прежнему рабочая.
  await ctx.reply(
    renderRatesMessage({ quoted, hasCash: electronic.length < pairs.length }),
    { parse_mode: 'HTML', ...WITHOUT_OLD_KEYBOARD },
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
      'Реферальная ссылка сейчас недоступна. Напишите менеджеру, он её пришлёт.',
      WITHOUT_OLD_KEYBOARD,
    );
    return;
  }

  // Ссылка отдельной строкой и без разметки: сообщение пересылают
  // целиком, и знакомый должен увидеть её глазами, а не разбирать, где
  // в тексте нажимать.
  await ctx.reply(
    `${getCore().getBotText('referral')}\n${link}`,
    WITHOUT_OLD_KEYBOARD,
  );
}
