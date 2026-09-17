'use client';

import { ErrorScreen } from '@nemo/ui';

/** Раздел кабинета не открылся: меню и шапка живы, уйти можно в соседний. */
export default function CabinetError({
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
      home={{ href: '/dashboard', label: 'На обзор' }}
      help="напишите в поддержку"
    />
  );
}
