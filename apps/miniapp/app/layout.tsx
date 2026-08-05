import { Manrope } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tobee — обмен валют',
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
  // Тот же индиго, что и у фона: Telegram красит им свою полосу над
  // приложением, и любой другой цвет читался бы швом поверх экрана.
  themeColor: '#161224',
};

/**
 * Шрифт попадает в сборку, а не тянется с чужого домена: Mini App
 * открывают на любой сети, и лишний круг до стороннего хоста виден
 * прямо в первой отрисовке.
 */
const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  // Начертания перечислены списком, но шрифт вариативный: на вес
  // сборки их число не влияет — файлы те же самые.
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
        {/*
          Талисман объявлен заранее, потому что заставка теперь
          безусловна: он нужен при каждом открытии, и ждать, пока до него
          доберётся React, значит терять на это всю гидрацию. Объявленный
          здесь, он едет с первых миллисекунд разбора страницы.

          Раньше так было нельзя: заставки на быстрой сети не бывало
          вовсе, и объявленная картинка тянулась бы туда, где её никто не
          увидит, — наперегонки с запросом сессии.
        */}
        <link rel="preload" as="image" href="/tobee-mascot.webp" type="image/webp" />
      </head>
      <body>{children}</body>
    </html>
  );
}
