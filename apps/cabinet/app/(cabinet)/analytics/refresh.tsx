'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * «Обновить» — пересчитать страницу сейчас, не дожидаясь тихого
 * обновления. Страница перерисовывается на месте: прежние числа стоят,
 * пока не придут новые, — вспышка пустого экрана читалась бы как «данных
 * не стало». Пока идёт пересчёт, кнопка говорит об этом словами.
 */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn--ghost btn--tiny"
      onClick={() => start(() => router.refresh())}
      aria-busy={pending}
    >
      {pending ? 'Обновляю…' : 'Обновить'}
    </button>
  );
}
