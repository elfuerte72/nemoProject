'use client';

import { ErrorScreen } from '@nemo/ui';

/**
 * Упал сам каркас панели — например, база не ответила на счётчики меню
 * — или экран входа. Меню показать нечем, и экран стоит карточкой.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorScreen
      error={error}
      reset={reset}
      home={{ href: '/', label: 'На рабочий стол' }}
      help="напишите разработчику"
      standalone={{ eyebrow: 'Панель менеджера' }}
    />
  );
}
