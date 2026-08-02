import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@nemo/core', '@nemo/http', '@nemo/telegram', '@nemo/types'],
  serverExternalPackages: ['postgres'],
  /** См. комментарии в apps/miniapp/next.config.ts. */
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  webpack: (config) => {
    // См. комментарий в apps/miniapp/next.config.ts: импорты пакетов
    // монорепо указывают `.js` там, где на диске `.ts`.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default config;
