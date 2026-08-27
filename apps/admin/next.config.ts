import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { gitSha } from '../../scripts/git-sha.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

const config: NextConfig = {
  /**
   * Коммит сборки — в `APP_VERSION`, который отдаёт `/api/health`.
   * Подставляется здесь, а не читается на старте: `.git` в образе нет,
   * а `env` Next вшивает в код в момент сборки. Пустая строка — сборка
   * вне репозитория; маршрут показывает её как `null`.
   */
  env: { APP_VERSION: gitSha(root) ?? '' },
  transpilePackages: ['@nemo/core', '@nemo/http', '@nemo/telegram', '@nemo/types'],
  serverExternalPackages: ['postgres'],
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
