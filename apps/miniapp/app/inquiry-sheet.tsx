'use client';

import { useState } from 'react';
import { ApiError, post } from '@/lib/client-api';
import { haptic } from '@/lib/telegram/webapp';
import { Sheet } from './ui/sheet';

/**
 * Просьба оплатить что-то за границей.
 *
 * Это не заявка: у неё нет ни состояний, ни курса, ни суммы к выдаче.
 * Чем именно станет оплата чужого счёта — по какому курсу считать и кто
 * несёт риск изменения цены между просьбой и оплатой, — ещё не решено, и
 * решать это до первых живых просьб значит решать наугад. Поэтому
 * просьба уходит обращением в ту же переписку, где клиент говорит с
 * менеджером обо всём остальном, а цену называет менеджер — как он
 * делает это с наличными, у которых курса тоже нет.
 *
 * Текст собирает приложение, а не клиент. Написавший «оплатите отель»
 * забывает назвать город, даты и сумму, и разговор начинается с трёх
 * уточняющих вопросов — по одному на каждое сообщение туда и обратно.
 * Подсказка в поле перечисляет то, без чего менеджер всё равно спросит.
 */

export type InquiryTopic = 'hotel' | 'purchase';

const TOPICS: Readonly<
  Record<InquiryTopic, { title: string; about: string; hint: string; placeholder: string }>
> = {
  hotel: {
    title: 'Оплатить отель',
    about:
      'Менеджер оплатит бронь со своей карты, а вы вернёте ему сумму обменом. Напишите, что и когда оплатить, — он посчитает и назовёт цену в чате.',
    hint: 'Отель и город, даты, сумма счёта и ссылка на бронь, если она есть.',
    placeholder: 'Hilton, Бангкок, 12–15 марта, 18 400 THB',
  },
  purchase: {
    title: 'Оплатить покупку',
    about:
      'Менеджер оплатит заказ в зарубежном магазине, а вы вернёте сумму обменом. Напишите, что нужно купить, — он посчитает и назовёт цену в чате.',
    hint: 'Магазин и ссылка на товар, сумма заказа, куда доставлять.',
    placeholder: 'Amazon, ссылка на товар, 240 USD, доставка в Москву',
  },
};

/** Столько же принимает и маршрут: ссылка, город, даты и сумма с запасом. */
const MAX_DETAILS = 1000;

export function InquirySheet({
  topic,
  onSent,
  onClose,
}: {
  readonly topic: InquiryTopic;
  readonly onSent: () => void;
  readonly onClose: () => void;
}) {
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const about = TOPICS[topic];

  async function send() {
    setError(undefined);
    setBusy(true);
    try {
      await post('/api/inquiries', { topic, details: details.trim() });
      haptic('success');
      onSent();
    } catch (failure) {
      haptic('error');
      setError(failure instanceof ApiError ? failure.message : 'Не удалось отправить просьбу');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={about.title} onClose={onClose}>
      <p className="sheet__body">{about.about}</p>

      <div className="form">
        <label className="field">
          <span className="field__label">Что нужно оплатить</span>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value.slice(0, MAX_DETAILS))}
            placeholder={about.placeholder}
            rows={4}
            className="input input--area"
          />
        </label>
        <p className="muted">{about.hint}</p>
      </div>

      {error ? <p className="error">{error}</p> : undefined}

      <div className="sheet__actions">
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || details.trim().length === 0}
          className="btn btn--gold"
        >
          {busy ? 'Отправляем…' : 'Отправить менеджеру'}
        </button>
      </div>
    </Sheet>
  );
}
