'use client';

import { useState } from 'react';

/**
 * Значение, которое забирают целиком: идентификатор клиента, код,
 * адрес.
 *
 * Кнопка, а не ссылка: по числовому идентификатору Telegram аккаунт не
 * открывает — окликнуть человека можно по нику или через бота. Забрать
 * же номер менеджеру нужно часто: он идёт в поиск, в заявку, в
 * сообщение коллеге, и выделять его мышью каждый раз — это его время.
 */
export function CopyValue({ value }: { readonly value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      // Отметка гаснет сама: подтверждение, которое надо закрывать,
      // требует внимания больше, чем само действие.
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Буфер закрыт настройками браузера — значение остаётся на
      // экране, и его всё ещё можно выделить мышью.
      setCopied(false);
    }
  }

  return (
    <button type="button" className="copy" onClick={copy} title="Скопировать">
      <span className="mono">{value}</span>
      <span className="copy__mark">{copied ? 'скопировано' : 'копировать'}</span>
    </button>
  );
}
