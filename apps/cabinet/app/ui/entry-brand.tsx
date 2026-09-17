import Link from 'next/link';
import { Brand } from '@nemo/ui';
import { DOORS_PATH } from '@/lib/entry';

/**
 * Знак над формой входа, заведения и экранами состояния — ссылка на
 * двери витрины.
 *
 * Без неё на этих экранах не было пути назад: пришедший не в ту дверь —
 * мерчант к амбассадору или наоборот — оставался перед чужой формой.
 * Ведёт на двери, а не на корень: корень уводит вошедшего в кабинет, а
 * отсюда уходят как раз за выбором.
 */
export function EntryBrand({ eyebrow = 'кабинет' }: { readonly eyebrow?: string }) {
  return (
    <div className="login__brand">
      <Link href={DOORS_PATH} className="login__home" aria-label="Tobee — выбрать вход">
        <Brand eyebrow={eyebrow} />
      </Link>
    </div>
  );
}
