import { loginBotToken } from '@/lib/auth/login-bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Вебхук бота, который подтверждает вход в админку (docs/adr/0005).
 *
 * У этого бота одна настоящая работа — показывать кнопку входа на
 * странице админки, и происходит она без всякого вебхука. Обработчик
 * нужен ради другого: молчащий бот выглядит сломанным, и первым делом в
 * нём начинают искать саму админ-панель. Это уже случалось при
 * развёртывании, и стоило нескольких заходов.
 *
 * Отвечает он на любое сообщение, а не только на `/start`. Сотрудник,
 * у которого вход не выходит, пишет боту словами — «не получается», — и
 * молчание в ответ он читает как «сломано и здесь». А ответ у бота один
 * и тот же на что угодно: адрес админки и порядок входа, то есть ровно
 * то, чего этому сотруднику не хватает. Команду при этом угадывать не
 * приходится: её не знают как раз те, кому бот и нужен.
 *
 * Только в личной переписке. Бота можно добавить в группу, и там
 * ответ на каждое сообщение — не помощь, а шум.
 *
 * Про клиентского бота здесь не рассказывается: клиенты этого бота не
 * видят и приходят не через него.
 *
 * Библиотека бота не подключается: один ответ не стоит зависимости, а
 * отправка идёт тем же прямым запросом к Bot API, что и во всём
 * остальном сервисе.
 */

interface TelegramUpdate {
  readonly message?: {
    readonly text?: string;
    readonly chat?: { readonly id?: number; readonly type?: string };
  };
}

function greeting(adminUrl: string): string {
  return [
    'Это служебный бот админ-панели nemoProject.',
    '',
    'Сам он ничего не делает — только подтверждает вход, когда вы',
    'нажимаете кнопку на странице входа.',
    '',
    `Админ-панель открывается в браузере: ${adminUrl}`,
    '',
    'Порядок входа:',
    '1. Откройте адрес выше в обычном браузере — Safari, Chrome.',
    '2. Нажмите синюю кнопку «Log in with Telegram» и подтвердите вход.',
    '3. Если ключ второго фактора вы ещё ни разу не вводили, на',
    '   следующем экране будет код для камеры: наведите на него',
    '   Google Authenticator (или Яндекс Ключ). Рядом тот же ключ',
    '   строкой — на случай, если камеры нет.',
    '4. Введите шесть цифр, которые покажет приложение.',
    '',
    'Если кнопка входа не появляется или код не подходит — напишите',
    'администратору: ключ он выдаёт заново одним нажатием.',
  ].join('\n');
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.ADMIN_BOT_WEBHOOK_SECRET;
  if (!expected) {
    return new Response('Вебхук не настроен', { status: 500 });
  }
  if (request.headers.get('x-telegram-bot-api-secret-token') !== expected) {
    return new Response('Неверный секрет вебхука', { status: 401 });
  }

  const adminUrl = process.env.ADMIN_URL;
  if (!adminUrl) {
    return new Response('Не задан ADMIN_URL', { status: 500 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const chat = update.message?.chat;

  /*
   * Ответ уходит на любое сообщение в личной переписке — на слова, на
   * стикер, на пересланное письмо. Что именно написали, значения не
   * имеет: сказать боту всё равно нечего, а сказать он может ровно
   * одно. На остальное — молча подтверждаем приём: Telegram повторяет
   * неотвеченные обновления, а повторять здесь нечего.
   */
  if (chat?.id !== undefined && chat.type === 'private') {
    try {
      await fetch(`https://api.telegram.org/bot${loginBotToken()}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(chat.id),
          text: greeting(adminUrl),
          disable_web_page_preview: true,
        }),
      });
    } catch (error) {
      // Неотправленный ответ не повод просить Telegram повторить
      // обновление: со второй попытки выйдет то же самое.
      console.error('Не удалось ответить боту входа', error);
    }
  }

  return new Response('ok');
}
