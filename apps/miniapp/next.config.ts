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
  /**
   * Mini App проверяется с телефона, а телефон приходит не на localhost:
   * Telegram открывает только https, и разработка идёт через туннель.
   * Для dev-сервера это чужой источник, и без разрешения он отказывает
   * в служебных запросах `/_next/*` — страница открывается, но горячая
   * замена молчит, и правка не доезжает до телефона.
   *
   * Списком, а не звёздочкой на всё: разрешение действует только в
   * разработке, но открывать его шире, чем один домен туннеля, незачем.
   */
  allowedDevOrigins: ['*.trycloudflare.com'],
  webpack: (config) => {
    // Пакеты монорепо импортируют друг друга по правилам ESM — с
    // расширением `.js` там, где на диске лежит `.ts`. Сборщику об этом
    // нужно сказать: сам он ищет файл ровно с тем именем, что написано.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default config;
