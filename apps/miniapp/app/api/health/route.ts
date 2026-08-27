import { healthResponse } from '@nemo/http';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Пульс приложения: после выката и для сторожка снаружи.
 *
 * Открыт без подписи Telegram — сторожку подписать нечем, — и потому
 * ответ не содержит ничего сверх «жив», имени, коммита сборки и слова
 * о базе. Что именно в нём есть и чего нет, решает обвязка в
 * `@nemo/http`: она одна на оба приложения.
 */
export async function GET(): Promise<Response> {
  return healthResponse({
    app: 'miniapp',
    // Подставлен на сборке из `.git` (см. `next.config.ts`); пустая
    // строка означает сборку вне репозитория.
    version: process.env.APP_VERSION || null,
    ping: () => getCore().pingDatabase(),
  });
}
