import { Onest } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'nemo — админ-панель',
};

/**
 * Шрифт тот же, что у клиента, и попадает в сборку, а не тянется с
 * чужого домена: панель открывают с рабочего места, где сторонние
 * домены закрыты чаще, чем кажется. Меняется он тоже вместе с
 * клиентским: разные гарнитуры у клиента и менеджера читались бы как
 * два разных сервиса.
 */
const ui = Onest({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ui',
  display: 'swap',
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={ui.variable}>
      <body>{children}</body>
    </html>
  );
}
