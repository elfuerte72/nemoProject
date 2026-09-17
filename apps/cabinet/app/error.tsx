'use client';

import { ErrorScreen } from '@nemo/ui';

/**
 * Упал каркас кабинета, витрина или экран входа: меню показать нечем, и
 * экран стоит карточкой.
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
      home={{ href: '/', label: 'На главную' }}
      help="напишите в поддержку"
      standalone={{ eyebrow: 'Кабинет' }}
    />
  );
}
