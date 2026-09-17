import type { ReactNode } from 'react';
import { EntryBrand } from '@/app/ui/entry-brand';
import { SignOut } from '@/app/ui/sign-out';
import { SupportLink } from '@/app/ui/support-link';

/**
 * Один экран вместо кабинета: почта не подтверждена, анкета на
 * рассмотрении или отклонена.
 *
 * Говорит, что происходит и чего ждать, и даёт единственное, что тут
 * можно сделать, — написать в поддержку. Меню в этих состояниях не
 * показывается: разделы всё равно пусты, а меню, из которого некуда
 * идти, обещает больше, чем есть.
 */
export function StateScreen({
  title,
  lines,
  support,
  action,
  eyebrow = 'кабинет',
  signOut,
}: {
  readonly title: string;
  readonly lines: readonly string[];
  readonly support: string | null;
  /** Что здесь можно сделать, кроме как написать в поддержку. */
  readonly action?: ReactNode;
  /** Подпись под знаком: у мерчанта кабинет, у амбассадора он сам. */
  readonly eyebrow?: string;
  /** Чью куку снимать при выходе: их в кабинете две. */
  readonly signOut?: { readonly path: string; readonly after: string };
}) {
  return (
    <main className="state">
      <div className="state__card">
        <EntryBrand eyebrow={eyebrow} />
        <h1 className="state__title">{title}</h1>
        {lines.map((line) => (
          <p key={line} className="state__text">
            {line}
          </p>
        ))}
        {action}
        <SupportLink username={support} className="btn btn--soft" />
        <SignOut {...signOut} />
      </div>
    </main>
  );
}
