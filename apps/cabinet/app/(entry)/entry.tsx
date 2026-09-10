'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Brand, Icon } from '@nemo/ui';
import { botLink, type EntryDoors } from '@/lib/entry';
import { send } from '@/app/ui/send';

/**
 * Две двери равного веса: бизнесу и амбассадору.
 *
 * Равного — потому что сервис не знает, кто пришёл, и не должен
 * угадывать: мерчант с почтой и паролем и блогер с Telegram в кармане
 * заходят одинаково часто. Третьей двери здесь нет: клиент меняет
 * деньги в Mini App, и ему сказано об этом строкой под дверьми — иначе
 * он ищет кнопку «войти», которой для него не бывает.
 */
export function Entry({ doors }: { readonly doors: EntryDoors }) {
  return (
    <main className="entry">
      <div className="entry__inner">
        <header className="entry__head">
          <Brand eyebrow="обмен валют" />
          <h1 className="entry__title">Кабинет Tobee</h1>
          <p className="entry__lead">
            Обмен рублей, USDT и валют выдачи: заявка, курс, выплата получателю. Здесь входят те,
            кто работает с сервисом, — бизнес и амбассадоры.
          </p>
        </header>

        <div className="entry__doors">
          <MerchantDoor />
          <AmbassadorDoor doors={doors} />
        </div>

        <p className="entry__foot">
          Меняете деньги для себя? Кабинет для этого не нужен — всё в Telegram
          {doors.botUsername ? (
            <>
              :{' '}
              <a className="entry__link" href={botLink(doors.botUsername) ?? '#'}>
                @{doors.botUsername}
              </a>
            </>
          ) : (
            ', в боте сервиса'
          )}
          .
        </p>
      </div>
    </main>
  );
}

function MerchantDoor() {
  return (
    <section className="door">
      <span className="door__icon" aria-hidden>
        <Icon name="account" size={20} />
      </span>
      <h2 className="door__title">Бизнесу</h2>
      <p className="door__text">
        Заявки от лица компании, получатели, курсы, ключи API и вебхуки. Вход по почте и паролю.
      </p>
      <Link href="/login" className="btn btn--gold btn--wide">
        Войти в кабинет
      </Link>
      <p className="door__note">
        Кабинета ещё нет? <Link href="/register">Заведите</Link> — анкету рассмотрит менеджер.
      </p>
    </section>
  );
}

/**
 * Кнопка Telegram: её рисует чужой скрипт, поэтому место под неё
 * держится заранее — без этого страница дёргалась бы, когда виджет
 * доедет. Пришедшее от него уходит своим маршрутом; он и проверяет
 * подпись.
 */
function AmbassadorDoor({ doors }: { readonly doors: EntryDoors }) {
  const slot = useRef<HTMLDivElement>(null);
  const [complaint, setComplaint] = useState<string>();

  useEffect(() => {
    const bot = doors.botUsername;
    if (!bot || !slot.current || slot.current.childElementCount > 0) return;

    (window as unknown as { onTobeeAmbassadorAuth?: (user: unknown) => void }).onTobeeAmbassadorAuth =
      async (user: unknown) => {
        const result = await send('/api/auth/ambassador', user);
        if (!result.ok) {
          setComplaint(result.complaint);
          return;
        }
        // Адресом, а не router: после появления куки нужен свежий
        // запрос, иначе оболочка приедет из кэша, собранного до входа.
        window.location.href = '/ambassador';
      };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', bot);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-onauth', 'onTobeeAmbassadorAuth(user)');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-radius', '12');
    slot.current.appendChild(script);
  }, [doors.botUsername]);

  return (
    <section className="door">
      <span className="door__icon" aria-hidden>
        <Icon name="spark" size={20} />
      </span>
      <h2 className="door__title">Амбассадору</h2>
      <p className="door__text">
        Приведённые, заработок по линиям, что брали ваши люди и вывод на свой реквизит. Вход через
        Telegram — тот аккаунт, который назвали менеджеру.
      </p>

      {doors.botUsername ? (
        <div className="door__widget" ref={slot} />
      ) : (
        <p className="door__note">{doors.ambassadorNote}</p>
      )}

      {complaint ? <p className="error">{complaint}</p> : undefined}

      <p className="door__note">
        Вас нет в программе? Она по приглашению: сервис зовёт каналы и чаты сам.
      </p>
    </section>
  );
}
