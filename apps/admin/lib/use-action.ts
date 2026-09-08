'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Действие над записью из панели: один запрос, отказ словами ядра,
 * перечитать страницу. Хук, а не компонент: у решений о мерчанте, у
 * личных ставок клиента и у правки баллов — свои кнопки и поля, а путь
 * запроса один. Возвращает, удалось ли: раскрытие закрывается только
 * после успеха, иначе набранное пропало бы вместе с ошибкой.
 */
export function useAction(path: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function act(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const said = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(said.error ?? 'Не вышло. Попробуйте ещё раз');
      }
      router.refresh();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не вышло');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, act };
}
