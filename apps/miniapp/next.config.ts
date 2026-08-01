import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@nemo/core', '@nemo/db', '@nemo/types', '@nemo/crypto'],
  serverExternalPackages: ['postgres'],
  webpack: (config) => {
    // Пакеты монорепо импортируют друг друга по правилам ESM — с
    // расширением `.js` там, где на диске лежит `.ts`. Сборщику об этом
    // нужно сказать: сам он ищет файл ровно с тем именем, что написано.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default config;
