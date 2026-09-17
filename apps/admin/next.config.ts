import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { gitSha } from '../../scripts/git-sha.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Заголовки безопасности на каждый ответ (`lib/next-config.test.ts`).
 *
 * Фрейм запрещён целиком: проверка «запрос только со своей страницы»
 * (`middleware.ts`) ничего не стоит, если саму панель встроить во фрейм
 * на чужом `*.sslip.io` и подложить под клик менеджера — запрос тогда
 * уходит с нашей страницы.
 *
 * Политики содержимого среди них нет намеренно, в отличие от кабинета.
 * Next ставит заголовок из настройки первым и одноимённый заголовок
 * маршрута после этого не пишет, а у файла клиента политика своя —
 * `sandbox` (`lib/attachment-response.ts`), и общая её бы перетёрла.
 * Фрейм запрещает `X-Frame-Options`: его понимает любой браузер.
 */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const config: NextConfig = {
  poweredByHeader: false,
  headers: async () => [{ source: '/:path*', headers: SECURITY_HEADERS }],
  experimental: {
    /*
     * При `middleware` Next копирует тело запроса для него и по умолчанию
     * обрезает копию на 10 МБ: маршрут получает только их. Файл клиенту
     * панель пускает до 20 МБ (столько Telegram отдаёт боту обратно), и
     * обрезанный multipart не разбирается вовсе. Запас — на обвязку
     * формы и подпись к файлу.
     */
    middlewareClientMaxBodySize: '22mb',
  },
  /**
   * Коммит сборки — в `APP_VERSION`, который отдаёт `/api/health`.
   * Подставляется здесь, а не читается на старте: `.git` в образе нет,
   * а `env` Next вшивает в код в момент сборки. Пустая строка — сборка
   * вне репозитория; маршрут показывает её как `null`.
   */
  env: { APP_VERSION: gitSha(root) ?? '' },
  transpilePackages: [
    '@nemo/brand',
    '@nemo/core',
    '@nemo/email',
    '@nemo/http',
    '@nemo/telegram',
    '@nemo/types',
    '@nemo/ui',
  ],
  // Читалки PDF и DOCX остаются пакетами Node, а не собираются в бандл:
  // у pdf.js внутри воркеры и необязательный canvas, и сборка их ломает.
  serverExternalPackages: ['postgres', 'unpdf', 'mammoth'],
  /** См. комментарии в apps/miniapp/next.config.ts. */
  outputFileTracingRoot: root,
  webpack: (config) => {
    // См. комментарий в apps/miniapp/next.config.ts: импорты пакетов
    // монорепо указывают `.js` там, где на диске `.ts`.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default config;
