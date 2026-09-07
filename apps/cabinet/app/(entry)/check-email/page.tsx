import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@nemo/ui';

export const metadata: Metadata = { title: 'Проверьте почту — кабинет Tobee' };

/**
 * После анкеты. Экран говорит, что произошло и чего ждать: без него
 * форма просто исчезает, и человек не знает, отправилось ли.
 */
export default function CheckEmailPage() {
  return (
    <main className="state">
      <div className="state__card">
        <div className="login__brand">
          <Brand eyebrow="кабинет" />
        </div>
        <h1 className="state__title">Проверьте почту</h1>
        <p className="state__text">
          Мы отправили письмо со ссылкой. Откройте её — и анкета уйдёт на рассмотрение;
          о решении мы напишем на тот же адрес. Ссылка работает сутки.
        </p>
        <p className="state__text">
          Письма нет через несколько минут — загляните в «Спам». Пришло не туда — заведите
          кабинет заново с верным адресом.
        </p>
        <Link className="btn btn--soft" href="/login">
          К входу
        </Link>
      </div>
    </main>
  );
}
