import { Brand } from '@nemo/ui';
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
}: {
  readonly title: string;
  readonly lines: readonly string[];
  readonly support: string | null;
}) {
  return (
    <main className="state">
      <div className="state__card">
        <div className="login__brand">
          <Brand eyebrow="кабинет" />
        </div>
        <h1 className="state__title">{title}</h1>
        {lines.map((line) => (
          <p key={line} className="state__text">
            {line}
          </p>
        ))}
        <SupportLink username={support} />
        <SignOut />
      </div>
    </main>
  );
}
