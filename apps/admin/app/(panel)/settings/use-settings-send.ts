'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Отправка настройки: один запрос, одна ошибка, одно «занято» на форму.
 *
 * Хук, а не общий компонент: подразделы настроек — разные страницы, и
 * у каждой свои поля, но путь у запроса один и тот же — отправить,
 * показать отказ ядра словами, перечитать страницу. Отказ показывается
 * словами ядра: там уже сказано, что не так с числом.
 */
export interface SettingsReply {
  readonly error?: string;
  readonly enrollmentSecret?: string;
  readonly qr?: string;
}

export function useSettingsSend() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function send(path: string, body: unknown): Promise<SettingsReply | undefined> {
    setError(undefined);
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as SettingsReply;
      if (!response.ok) {
        setError(payload.error ?? 'Настройка не сохранена');
        return undefined;
      }
      router.refresh();
      return payload;
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return { error, busy, send };
}
