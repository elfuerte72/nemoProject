import { NotFoundScreen } from '@nemo/ui';

/**
 * Адрес, которого у панели нет вовсе. Каркаса здесь нет — сессию никто
 * не спрашивал, — и экран стоит карточкой, как вход.
 */
export default function RootNotFound() {
  return (
    <NotFoundScreen
      home={{ href: '/', label: 'На рабочий стол' }}
      standalone={{ eyebrow: 'Панель менеджера' }}
    />
  );
}
