import { Manrope } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'nemo — админ-панель',
};

/**
 * Шрифт тот же, что у клиента, и попадает в сборку, а не тянется с
 * чужого домена: панель открывают с рабочего места, где сторонние
 * домены закрыты чаще, чем кажется.
 */
const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-manrope',
  display: 'swap',
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
