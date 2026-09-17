import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { gitSha } from '../../scripts/git-sha.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Заголовки безопасности на каждый ответ (`lib/security-headers.test.ts`).
 *
 * Фрейм запрещён целиком: кабинет не встраивается никуда, а раздел
 * «Сотрудники» или выпуск ключа, подложенные во фрейм под клик
 * владельца, выдали бы доступ чужому. Политика содержимого — одна
 * директива `frame-ancestors`: полная политика скриптов сломала бы
 * вставки Next и виджет Telegram на витрине, а защищает здесь именно
 * фрейм. HSTS — год и только на этот хост: соседние поддомены sslip.io
 * не наши.
 */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const config: NextConfig = {
  /** Коммит сборки — в `APP_VERSION`; см. `apps/miniapp/next.config.ts`. */
  env: { APP_VERSION: gitSha(root) ?? '' },
  poweredByHeader: false,
  headers: async () => [{ source: '/:path*', headers: SECURITY_HEADERS }],
  transpilePackages: [
    '@nemo/brand',
    '@nemo/core',
    '@nemo/email',
    '@nemo/http',
    '@nemo/qr',
    '@nemo/rates',
    '@nemo/types',
    '@nemo/ui',
  ],
  serverExternalPackages: ['postgres'],
  /** См. комментарии в apps/miniapp/next.config.ts. */
  outputFileTracingRoot: root,
  webpack: (config, { nextRuntime, webpack }) => {
    // Импорты пакетов монорепо указывают `.js` там, где на диске `.ts`.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    /*
     * Договор API (`docs/api/merchant-v1.yaml`) едет в бандл строкой:
     * страница «Документация» показывает ту версию, с которой собрано
     * приложение, и на диск в контейнере за ней не ходит.
     */
    config.module.rules.push({ test: /\.ya?ml$/, type: 'asset/source' });
    /*
     * Хук запуска (`instrumentation.ts`) Next собирает под каждый
     * рантайм — в том числе пограничный, которого у приложения нет.
     * Ядро туда не собирается вовсе: в нём `node:crypto` и драйвер
     * базы, а схемы `node:` пограничный сборщик не разбирает — и
     * dev-сервер отвечал пятисотым на любой странице.
     *
     * Поэтому там ядра просто нет: хук выходит из себя по
     * `NEXT_RUNTIME` раньше, чем позовёт его, а пустой модуль ничего не
     * ломает. В серверном бандле — всё как было.
     */
    if (nextRuntime === 'edge') {
      config.resolve.alias = { ...config.resolve.alias, '@nemo/core': false };
      /*
       * Воркер вебхуков разрешает имя приёмника через `node:dns` — той
       * же схемы `node:`, что и ядро. В пограничном бандле его нет и не
       * будет: хук выходит по `NEXT_RUNTIME` раньше, чем позовёт воркер.
       */
      config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^node:dns\/promises$/ }));
    }
    return config;
  },
};

export default config;
