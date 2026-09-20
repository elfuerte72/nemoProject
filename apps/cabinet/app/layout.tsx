import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@nemo/ui/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tobee — кабинет мерчанта',
};

/**
 * Шрифты кабинета — IBM Plex, обе ветви семейства.
 *
 * Выбраны 20 сентября 2026 вместе с характером экрана: моноширинные
 * цифры стоят ровной колонкой, и два числа под двумя другими
 * сравниваются взглядом, а не чтением. Это же даёт кабинету профессию —
 * приём из банковских выписок, а не из шаблона панели показателей.
 *
 * Панель менеджера и Mini App остаются на Onest: там другая тема и
 * другой человек за экраном.
 *
 * Оба попадают в сборку, а не тянутся с чужого домена: кабинет
 * открывают с рабочего места, где сторонние домены закрыты чаще, чем
 * кажется.
 */
const ui = IBM_Plex_Sans({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ui',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

/**
 * Тема кабинета светлая и задаётся здесь, атрибутом на корне: набор
 * токенов один на оба рабочих интерфейса (`@nemo/ui/styles.css`), а
 * значений два.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" data-theme="light" className={`${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
