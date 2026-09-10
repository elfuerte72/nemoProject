'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { botLink, type EntryDoors } from '@/lib/entry';
import { EntryMark } from './entry-mark';
import { send } from '@/app/ui/send';

/**
 * Витрина: знак и две двери равного веса.
 *
 * Равного — потому что сервис не знает, кто пришёл, и не должен
 * угадывать: мерчант с почтой и паролем и блогер с Telegram в кармане
 * заходят одинаково часто. Двери стоят парой и одинаковой высоты, а
 * различают их не размер, а цвет входа: медовый у бизнеса, синий
 * Telegram у амбассадора.
 *
 * Третьей двери здесь нет: клиент меняет деньги в Mini App, и ему
 * сказано об этом строкой под дверьми — иначе он ищет кнопку «войти»,
 * которой для него не бывает.
 *
 * Сверху — знак, повёрнутый в толщу (`entry-mark.tsx`): тот же, каким
 * сервис здоровается в Mini App. Ни заголовка, ни рассказа о сервисе
 * над дверьми нет: страница отвечает на «куда мне войти», и человек,
 * дошедший до неё, уже знает, куда пришёл, — а знак и надстрочник
 * говорят это быстрее любой строки.
 */
export function Entry({ doors }: { readonly doors: EntryDoors }) {
  return (
    <main className="entry">
      <div className="entry__inner">
        <header className="entry__head">
          <EntryMark />
          <h1 className="entry__eyebrow">tobee · обмен валют</h1>
        </header>

        <div className="entry__doors">
          <MerchantDoor />
          <AmbassadorDoor doors={doors} />
        </div>

        {/*
          Клиенту здесь входить некуда — он меняет деньги в Mini App, — и
          вместо объяснения стоит сама дверь: кнопка ведёт прямо в бота.
          Без имени бота её нет вовсе: ссылка в никуда хуже её
          отсутствия.
        */}
        {doors.botUsername ? (
          <a
            className="btn btn--soft entry__bot"
            href={botLink(doors.botUsername) ?? '#'}
            title="Обмен для себя — в Telegram"
          >
            <TelegramGlyph />@{doors.botUsername}
          </a>
        ) : undefined}
      </div>
    </main>
  );
}

/** Знак Telegram — один на кнопку бота и на подпись двери. */
function TelegramGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21.5 4.3 18.6 19.1c-.2 1-.8 1.2-1.6.8l-4.5-3.3-2.2 2.1c-.2.2-.4.4-.9.4l.3-4.6 8.3-7.5c.4-.3-.1-.5-.6-.2L7.2 13l-4.4-1.4c-1-.3-1-1 .2-1.4l17.2-6.6c.8-.3 1.5.2 1.3 1.7Z" />
    </svg>
  );
}

function MerchantDoor() {
  return (
    <section className="door door--gold">
      <span className="door__edge" />
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
 * Кнопку Telegram рисует чужой скрипт, поэтому место под неё держится
 * заранее — без этого страница дёргалась бы, когда виджет доедет.
 * Пришедшее от него уходит своим маршрутом; он и проверяет подпись.
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
    <section className="door door--telegram">
      <span className="door__edge" />
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
