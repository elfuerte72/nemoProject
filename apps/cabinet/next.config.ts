import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { gitSha } from '../../scripts/git-sha.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

const config: NextConfig = {
  /** Коммит сборки — в `APP_VERSION`; см. `apps/miniapp/next.config.ts`. */
  env: { APP_VERSION: gitSha(root) ?? '' },
  transpilePackages: [
    '@nemo/brand',
    '@nemo/core',
    '@nemo/email',
    '@nemo/http',
    '@nemo/types',
    '@nemo/ui',
  ],
  serverExternalPackages: ['postgres'],
  /** См. комментарии в apps/miniapp/next.config.ts. */
  outputFileTracingRoot: root,
  webpack: (config, { nextRuntime }) => {
    // Импорты пакетов монорепо указывают `.js` там, где на диске `.ts`.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
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
    }
    return config;
  },
};

export default config;
