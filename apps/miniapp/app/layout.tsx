import { Manrope } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nemo — обмен валют',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Mini App разворачивается на весь экран Telegram; масштабирование
  // ломает вёрстку полей ввода на iOS.
  maximumScale: 1,
  userScalable: false,
  // Нижняя панель садится на область системных жестов, если её не
  // измерить: `env(safe-area-inset-*)` заполняется только при `cover`.
  viewportFit: 'cover',
  themeColor: '#0A0A0C',
};

/**
 * Шрифт попадает в сборку, а не тянется с чужого домена: Mini App
 * открывают на любой сети, и лишний круг до стороннего хоста виден
 * прямо в первой отрисовке.
 */
const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={manrope.variable}>
      <head>
        {/*
          Без `async`: данные запуска нужны первому же запросу к серверу,
          и гидрация не должна их дожидаться.
        */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
