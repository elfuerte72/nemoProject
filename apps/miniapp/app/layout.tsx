import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Обмен валют',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Mini App разворачивается на весь экран Telegram; масштабирование
  // ломает вёрстку полей ввода на iOS.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js" async />
      </head>
      <body>{children}</body>
    </html>
  );
}
