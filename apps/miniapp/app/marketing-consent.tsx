'use client';

import { useState } from 'react';
import { ApiError, post } from '@/lib/client-api';
import { Sheet } from './ui/sheet';

/**
 * Согласие на рассылку.
 *
 * При первом входе клиента спрашивают прямо — листом поверх экрана,
 * который не даёт пройти мимо. Дальше отписка остаётся одной кнопкой на
 * виду, внизу любого раздела: спрятанная в настройках отписка — это
 * способ не получить её вовсе.
 */
export function MarketingConsent({
  askNow,
  consent,
  onAnswered,
}: {
  readonly askNow: boolean;
  readonly consent: boolean;
  readonly onAnswered: (consent: boolean) => void;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function answer(value: boolean) {
    setError(undefined);
    setBusy(true);
    try {
      const result = await post<{ marketingConsent: boolean }>('/api/marketing-consent', {
        consent: value,
      });
      onAnswered(result.marketingConsent);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось сохранить ответ');
    } finally {
      setBusy(false);
    }
  }

  if (askNow) {
    return (
      // Лист закрывается только ответом: `onClose` здесь — «не нужно».
      // Вопрос задан один раз, и уход от него молчанием вернул бы его
      // при следующем запуске.
      <Sheet title="Присылать новости?" onClose={() => void answer(false)}>
        <p className="sheet__body">
          Предложения и новости сервиса. Заявок и их статусов это не касается — о них бот
          сообщает всегда.
        </p>
        {error ? <p className="error">{error}</p> : undefined}
        <div className="sheet__actions">
          <button
            type="button"
            onClick={() => void answer(true)}
            disabled={busy}
            className="btn btn--gold"
          >
            Присылать
          </button>
          <button
            type="button"
            onClick={() => void answer(false)}
            disabled={busy}
            className="btn btn--soft"
          >
            Не нужно
          </button>
        </div>
      </Sheet>
    );
  }

  // Переключатель, а не «отписаться»: одна кнопка умела только выключить,
  // и передумавшему клиенту нечем было включить рассылку обратно.
  return (
    <>
      <button
        type="button"
        onClick={() => void answer(!consent)}
        disabled={busy}
        aria-pressed={consent}
        className="toggle"
      >
        <span className="toggle__label">
          Новости и предложения
          <span className="toggle__note">
            О заявках бот пишет всегда — этого переключателя они не касаются.
          </span>
        </span>
        <span className="toggle__track">
          <span className="toggle__knob" />
        </span>
      </button>
      {error ? <p className="error">{error}</p> : undefined}
    </>
  );
}
