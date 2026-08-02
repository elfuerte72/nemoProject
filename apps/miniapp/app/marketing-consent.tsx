'use client';

import { useState } from 'react';
import { ApiError, post } from '@/lib/client-api';
import { Sheet } from './ui/sheet';

/**
 * Согласие на рассылку.
 *
 * Вопрос и переключатель разведены по местам, потому что живут в разное
 * время. Вопрос задаётся один раз при первом входе — листом поверх
 * любого раздела, мимо которого не пройти. Переключатель нужен потом и
 * редко, и его место — в кабинете, рядом с прочим о самом клиенте, а не
 * под каждым экраном.
 */

/** Сохранить ответ. Общее для вопроса и переключателя. */
function useAnswer(onAnswered: (consent: boolean) => void) {
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

  return { answer, error, busy };
}

/**
 * Вопрос при первом входе. Висит, пока клиент на него не ответил, а не
 * только в первую сессию: закрывший приложение до ответа иначе не увидел
 * бы его больше никогда.
 */
export function MarketingConsentAsk({
  onAnswered,
}: {
  readonly onAnswered: (consent: boolean) => void;
}) {
  const { answer, error, busy } = useAnswer(onAnswered);

  return (
    // Лист закрывается только ответом: `onClose` здесь — «не нужно».
    // Уход от вопроса молчанием вернул бы его при следующем запуске.
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

/**
 * Переключатель — на виду в кабинете, а не в настройках, которых у
 * приложения нет. Именно переключатель, а не «отписаться»: одна кнопка
 * умела только выключить, и передумавшему клиенту нечем было включить
 * рассылку обратно.
 */
export function MarketingConsentToggle({
  consent,
  onAnswered,
}: {
  readonly consent: boolean;
  readonly onAnswered: (consent: boolean) => void;
}) {
  const { answer, error, busy } = useAnswer(onAnswered);

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
