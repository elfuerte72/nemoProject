'use client';

import { ErrorScreen } from '@nemo/ui';

/**
 * Раздел панели не открылся: упала страница, а меню и шапка живы, и
 * менеджер уходит отсюда в соседний раздел, не теряя панель.
 */
export default function PanelError({
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
    />
  );
}
