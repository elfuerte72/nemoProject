'use client';

import { ErrorScreen } from '@nemo/ui';

/** Раздел кабинета амбассадора не открылся: меню и шапка живы. */
export default function AmbassadorError({
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
      home={{ href: '/ambassador', label: 'На обзор' }}
      help="напишите в поддержку"
    />
  );
}
