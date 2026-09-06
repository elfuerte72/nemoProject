import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Плитка показателя: подпись, число, пояснение.
 *
 * Число крупно, а под ним — строка, которая делает его честным: «все
 * обработаны», «из них 3 мои», «было 12». Число без такой строки
 * читается как факт о работе, а оно — срез на момент показа.
 *
 * Тон — по тому же правилу, что у пилюль состояния: золото — ждёт
 * человека, зелёное — готово, красное — отказ. Без тона плитка
 * нейтральна: не всякий показатель кого-то зовёт.
 */

export type StatTone = 'plain' | 'wait' | 'up' | 'down';

export function Stats({ children }: { children: ReactNode }) {
  return <div className="stats">{children}</div>;
}

export function Stat({
  label,
  value,
  note,
  tone = 'plain',
  href,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: StatTone;
  /** Плитка-ссылка ведёт туда, где число становится списком. */
  href?: string;
}) {
  const className = `stat stat--${tone}`;
  const body = (
    <>
      <span className="stat__label">
        <span className="stat__dot" aria-hidden />
        {label}
      </span>
      <span className="stat__value">{value}</span>
      {note ? <span className="stat__note">{note}</span> : undefined}
    </>
  );

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
