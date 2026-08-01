import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@nemo/core', '@nemo/http', '@nemo/telegram', '@nemo/types'],
  serverExternalPackages: ['postgres'],
  webpack: (config) => {
    // См. комментарий в apps/miniapp/next.config.ts: импорты пакетов
    // монорепо указывают `.js` там, где на диске `.ts`.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default config;
