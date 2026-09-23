'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * «Скопировать ссылку» на оплату — для покупателя, который не у стойки:
 * ссылку отправляют ему в переписку, и он платит со своего телефона.
 *
 * Ссылка — та же, что зашита в QR (`QrView.link`), и живёт столько же:
 * QR перевыпускается каждые пять минут, и вместе с ним ссылка. Поэтому
 * кнопка копирует действующую в момент нажатия, а подпись под ней
 * говорит, сколько та проживёт.
 *
 * Отметка «Скопировано» гаснет сама: подтверждение, которое надо
 * закрывать, — лишнее действие. Буфер обмена недоступен (страница не по
 * HTTPS, запрет браузера) — кнопка говорит «Не скопировалось», а не
 * молчит.
 */
export function CopyLink({ link }: { readonly link: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setState('done');
    } catch {
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1800);
  }

  return (
    <button type="button" className="btn btn--soft copy-link" onClick={() => void copy()}>
      <span aria-live="polite">
        {state === 'done' ? 'Скопировано' : state === 'failed' ? 'Не скопировалось' : 'Скопировать ссылку'}
      </span>
    </button>
  );
}
