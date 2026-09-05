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
  transpilePackages: ['@nemo/brand', '@nemo/core', '@nemo/http', '@nemo/telegram', '@nemo/types'],
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
