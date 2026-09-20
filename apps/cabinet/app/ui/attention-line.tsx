import Link from 'next/link';
import type { Attention } from '@/lib/attention';

/**
 * Строка над обзором: что требует внимания прямо сейчас.
 *
 * Ничего не требует — не рисуется вовсе, и это её главное свойство
 * (правило и причина — `lib/attention.ts`). Поэтому компонент возвращает
 * пустоту, а не плашку «всё в порядке».
 *
 * Ссылкой целиком, а не строкой с кнопкой сбоку: беда одна, действие у
 * неё одно, и цель нажатия во всю ширину попадает и мышью, и пальцем.
 */
export function AttentionLine({ one }: { one: Attention | null }) {
  if (one === null) return null;

  return (
    <Link className={`attention attention--${one.tone}`} href={one.href}>
      <span className="attention__label">{one.label}</span>
      <span className="attention__text">{one.text}</span>
      <span className="attention__go" aria-hidden="true">
        Открыть →
      </span>
    </Link>
  );
}
