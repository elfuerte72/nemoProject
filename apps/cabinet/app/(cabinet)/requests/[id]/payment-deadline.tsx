'use client';

import { useEffect, useState } from 'react';
import { Moment } from '@nemo/ui';
import { leftWords, paymentDeadlineOf } from '@/lib/request-card';

/**
 * Срок оплаты — моментом и остатком: «Оплатить до 19:07 · осталось
 * 1 ч 12 мин».
 *
 * Считает его правило (`paymentDeadlineOf`), а здесь только часы:
 * остаток убывает сам, раз в минуту и без запроса к серверу — это
 * вычитание из уже известного момента. Сам момент печатает браузер
 * (`Moment`): сервер живёт в UTC, и мерчант увидел бы время, которого
 * на его часах не было.
 *
 * До первого тика остаток не показан вовсе: «сейчас» у сервера и у
 * браузера разное, и число, посчитанное на сервере, через мгновение
 * сменилось бы другим прямо под взглядом.
 */
export function PaymentDeadlineLine({
  issuedAt,
  ttlMinutes,
}: {
  /** Когда выданы реквизиты — строкой: между сервером и клиентом ездят данные. */
  readonly issuedAt: string;
  readonly ttlMinutes: number;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const issued = new Date(issuedAt);
  const deadline = paymentDeadlineOf(issued, ttlMinutes, now ?? issued);
  if (!deadline) return null;

  if (now && deadline.state === 'over') {
    return (
      <p className="deadline deadline--over" role="status">
        Срок оплаты вышел, заявка будет отменена. Если перевод уже ушёл, напишите в
        поддержку.
      </p>
    );
  }

  return (
    <p className={deadline.state === 'soon' && now ? 'deadline deadline--soon' : 'deadline'}>
      <span>
        Оплатить до <Moment at={deadline.at.toISOString()} />
      </span>
      {now ? (
        <span className="deadline__left" role="timer" aria-live="off">
          осталось {leftWords(deadline.leftMinutes)}
        </span>
      ) : undefined}
      <span className="deadline__why">
        Столько держится курс: неоплаченную в срок заявку сервис отменит.
      </span>
    </p>
  );
}
