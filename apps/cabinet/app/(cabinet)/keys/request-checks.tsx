'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { send } from '@/app/ui/send';

/**
 * «Проверки запроса»: что сверх ключа сервис требует от вызова.
 *
 * Подпись включается здесь же, переключателем, и о последствии сказано
 * до нажатия: включивший «на всякий случай» иначе увидел бы 401 на всех
 * своих запросах через минуту. Разрешённые адреса ведутся ниже, своей
 * карточкой, — здесь только их итог.
 */
export function RequestChecks({
  signatureRequired,
  addressCount,
}: {
  readonly signatureRequired: boolean;
  readonly addressCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setComplaint(undefined);
    const result = await send('/api/signature', { required: !signatureRequired });
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    router.refresh();
  }

  return (
    <section className="card">
      <h2 className="card__title">Проверки запроса</h2>
      <dl className="kv">
        <div className="kv__row">
          <dt className="kv__name">
            Подпись HMAC
            <span className="kv__hint">x-timestamp и x-signature у каждого вызова</span>
          </dt>
          <dd className="kv__value">
            <button
              type="button"
              role="switch"
              aria-checked={signatureRequired}
              // Имя постоянное: подпись рядом меняется вместе с состоянием,
              // и диктор читал бы «не требуется, переключатель, выключен».
              aria-label="Требовать подпись HMAC"
              className={signatureRequired ? 'switch switch--on' : 'switch'}
              onClick={() => void toggle()}
              // Не `disabled`: погашенная кнопка теряет фокус, и работающий
              // с клавиатуры оказывается в начале страницы.
              aria-busy={busy}
            >
              <span className="switch__track" aria-hidden />
              {signatureRequired ? 'обязательна' : 'не требуется'}
            </button>
          </dd>
        </div>
        <div className="kv__row">
          <dt className="kv__name">
            Разрешённые адреса
            <span className="kv__hint">откуда принимаются вызовы</span>
          </dt>
          <dd className="kv__value">
            {addressCount === 0 ? (
              'с любого адреса'
            ) : (
              <a href="#addresses">только из списка · {addressCount}</a>
            )}
          </dd>
        </div>
      </dl>
      {complaint ? <p className="error">{complaint}</p> : undefined}
      <p className="card__note">
        {signatureRequired
          ? 'Подпись включена: вызов без неё или с чужой получает 401 invalid_signature.'
          : 'Подпись выключена: вызов удостоверяет только ключ. Включайте, когда код готов ' +
            'подписывать каждый запрос, — иначе все вызовы начнут получать 401.'}
      </p>
    </section>
  );
}
