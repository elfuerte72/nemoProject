import { Onest } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@nemo/ui/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tobee — кабинет мерчанта',
};

/**
 * Шрифт тот же, что у клиента и в панели, и попадает в сборку, а не
 * тянется с чужого домена: кабинет открывают с рабочего места, где
 * сторонние домены закрыты чаще, чем кажется.
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
