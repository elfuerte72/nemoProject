import type { ReactNode } from 'react';
import { SettingsNav } from './settings-nav';

/**
 * Каркас настроек: заголовок, подменю, подраздел под ним.
 *
 * Сессию каркас не проверяет — это делает каждая страница: данные
 * закрывают операции ядра, а не разметка, и один отказ в каркасе
 * защищал бы заголовок, а не настройки.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Настройки</h1>
          <p className="page__sub">
            Экономика сервиса, справочники и сотрудники. Изменения действуют вперёд и
            попадают в журнал.
          </p>
        </div>
        <SettingsNav />
      </header>
      {children}
    </main>
  );
}
