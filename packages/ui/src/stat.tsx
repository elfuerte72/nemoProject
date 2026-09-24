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
  current = false,
  wide = false,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: StatTone;
  /** Плитка-ссылка ведёт туда, где число становится списком. */
  href?: string;
  /**
   * Плитка показывает то, что открыто сейчас. Так плитки служат
   * переключателем выборки — «В работе», «Исполнены», — и текущая
   * отмечена не только цветом: экранному диктору об этом говорит
   * `aria-current`.
   */
  current?: boolean;
  /**
   * Плитка в две колонки — для денег по валютам: у суммы и «было» в
   * одной строке в узкой плитке места нет, и она вытягивалась бы
   * втрое выше соседей.
   */
  wide?: boolean;
}) {
  const className = `stat stat--${tone}${current ? ' stat--current' : ''}${wide ? ' stat--wide' : ''}`;
  const body = (
    <>
      <span className="stat__label">
        <span className="stat__dot" aria-hidden />
        {label}
      </span>
      {/*
        Число — блоком, а не строкой: в плитку кладут и список денег по
        валютам, а список внутри строчного элемента — невалидная разметка.
      */}
      <div className="stat__value">{value}</div>
      {note ? <span className="stat__note">{note}</span> : undefined}
    </>
  );

  return href ? (
    <Link href={href} className={className} {...(current ? { 'aria-current': 'page' as const } : {})}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * Тон плитки по сравнению с прошлым периодом: больше — зелёное, меньше
 * — красное, столько же — нейтральное. Одно правило на аналитику
 * панели, карточку мерчанта и обзор кабинета. Для чисел, у которых
 * рост — плохо (отменено), вызывающий выбирает тон сам.
 */
export function trendTone(now: number | null, before: number | null): StatTone {
  if (now === null || before === null) return 'plain';
  if (now > before) return 'up';
  if (now < before) return 'down';
  return 'plain';
}
