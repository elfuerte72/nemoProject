'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { send } from '@/app/ui/send';

/**
 * Тумблер подписи. Включённая обязательна для каждого вызова, и об
 * этом сказано до нажатия: включивший «на всякий случай» иначе увидел
 * бы 401 на всех своих запросах через минуту.
 */
export function SignatureToggle({ required }: { readonly required: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();

  async function toggle(next: boolean) {
    setBusy(true);
    setComplaint(undefined);
    const result = await send('/api/signature', { required: next });
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    router.refresh();
  }

  return (
    <section className="card">
      <h2 className="card__title">Подпись запросов</h2>
      <p className="card__note">
        {required
          ? 'Включена: каждый вызов обязан нести x-timestamp и x-signature, иначе получит 401.'
          : 'Выключена: вызовы удостоверяет только ключ. Включайте, когда код готов подписывать ' +
            'каждый запрос.'}
      </p>
      {complaint ? <p className="error">{complaint}</p> : undefined}
      <label className="check">
        <input
          type="checkbox"
          checked={required}
          disabled={busy}
          onChange={(event) => void toggle(event.target.checked)}
        />
        Требовать подпись HMAC у каждого запроса
      </label>
    </section>
  );
}
