/**
 * Зарегистрировать вебхук бота в Telegram.
 *
 * Бот принимает обновления вебхуком, а не опросом: приложение живёт на
 * serverless, где некому держать длинный опрос между запросами
 * (docs/adr/0001). Адрес вебхука — маршрут клиентского приложения
 * `/api/bot`.
 *
 * Секретный токен обязателен и передаётся здесь же: адрес вебхука рано
 * или поздно утекает, и без него кто угодно сможет присылать боту
 * поддельные обновления. Маршрут сверяет его с заголовком
 * `x-telegram-bot-api-secret-token` и без совпадения не отвечает.
 *
 * Запуск:
 *   pnpm set-telegram-webhook            — зарегистрировать
 *   pnpm set-telegram-webhook --info     — показать, что зарегистрировано
 *   pnpm set-telegram-webhook --delete   — снять
 */

const API = 'https://api.telegram.org';

/**
 * Какие обновления нужны боту. Перечислены явно: по умолчанию Telegram
 * шлёт почти всё, а бот отвечает на `/start` и текст — остальное только
 * расходует запросы и попадает в логи.
 */
const ALLOWED_UPDATES = ['message', 'callback_query'];

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Не задан ${name}`);
    process.exit(1);
  }
  return value;
}

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: unknown;
}

async function call(token: string, method: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = (await response.json()) as TelegramResponse;
  if (!payload.ok) {
    throw new Error(`Telegram отказал на ${method}: ${payload.description ?? response.status}`);
  }
  return payload.result;
}

async function main(): Promise<void> {
  const token = required('TELEGRAM_BOT_TOKEN');
  const mode = process.argv[2];

  if (mode === '--info') {
    console.log(JSON.stringify(await call(token, 'getWebhookInfo'), null, 2));
    return;
  }

  if (mode === '--delete') {
    await call(token, 'deleteWebhook');
    console.log('Вебхук снят. Бот перестал получать обновления.');
    return;
  }

  const appUrl = required('MINIAPP_URL').replace(/\/+$/, '');
  const secret = required('TELEGRAM_WEBHOOK_SECRET');
  const url = `${appUrl}/api/bot`;

  await call(token, 'setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ALLOWED_UPDATES,
    // Обновления, накопившиеся, пока вебхука не было, отбрасываются:
    // после переезда домена они относятся к прошлой жизни сервиса, а
    // ответить на них через час после отправки хуже, чем не ответить.
    drop_pending_updates: true,
  });

  console.log(`Вебхук зарегистрирован: ${url}`);
  console.log('Проверить: pnpm set-telegram-webhook --info');
}

// Отказ Telegram — не авария скрипта: чаще всего это неверный токен или
// адрес, до которого не достучаться. Стек в этом случае только мешает.
await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
