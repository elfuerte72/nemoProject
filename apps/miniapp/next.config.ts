import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: [
    '@nemo/core',
    '@nemo/http',
    '@nemo/rates',
    '@nemo/telegram',
    '@nemo/types',
  ],
  serverExternalPackages: ['postgres'],
  /**
   * Корень монорепо указан явно: иначе Next ищет его сам и в образе, где
   * рядом нет ни `.git`, ни второго приложения, может ошибиться.
   *
   * Самодостаточной сборки (`output: 'standalone'`) здесь нет намеренно:
   * драйвер базы объявлен внешним, и в такую сборку он не попадает —
   * приложение падало бы на первом же обращении к базе. Образ несёт всё
   * рабочее пространство целиком; он крупнее, но работает.
   */
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  webpack: (config) => {
    // Пакеты монорепо импортируют друг друга по правилам ESM — с
    // расширением `.js` там, где на диске лежит `.ts`. Сборщику об этом
    // нужно сказать: сам он ищет файл ровно с тем именем, что написано.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default config;
