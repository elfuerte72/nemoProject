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
 * Про клиентского бота здесь не рассказывается: клиенты этого бота не
 * видят и приходят не через него.
 *
 * Библиотека бота не подключается: одна команда и один ответ не стоят
 * зависимости, а отправка идёт тем же прямым запросом к Bot API, что и
 * во всём остальном сервисе.
 */

interface TelegramUpdate {
  readonly message?: {
    readonly text?: string;
    readonly chat?: { readonly id?: number };
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
    'Для входа понадобится код из приложения-аутентификатора — того,',
    'куда вы добавили выданный администратором ключ.',
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
  const chatId = update.message?.chat?.id;
  const text = update.message?.text ?? '';

  // Отвечаем только на обращение к боту. На всё остальное — молча
  // подтверждаем приём: Telegram повторяет неотвеченные обновления, а
  // повторять здесь нечего.
  if (chatId !== undefined && text.startsWith('/start')) {
    try {
      await fetch(`https://api.telegram.org/bot${loginBotToken()}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(chatId),
          text: greeting(adminUrl),
          disable_web_page_preview: true,
        }),
      });
    } catch (error) {
      // Неотправленный ответ не повод просить Telegram повторить
      // обновление: со второй попытки выйдет то же самое.
      console.error('Не удалось ответить на /start', error);
    }
  }

  return new Response('ok');
}
