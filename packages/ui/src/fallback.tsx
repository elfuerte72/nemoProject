import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from './brand.js';
import { EmptyState } from './empty.js';
import type { IconName } from './icons.js';

/**
 * Экран вместо страницы: такой нет или она не открылась.
 *
 * Панель и кабинет показывают его одними словами и одним видом: адрес,
 * набранный с ошибкой, и сбой на сервере одинаковы у менеджера и у
 * мерчанта, а английская страница Next без меню не говорит ни что
 * случилось, ни куда идти. Разница у приложений одна — куда вести назад
 * и кого звать, если не проходит.
 *
 * Мест два. В каркасе — под меню и шапкой, пустым состоянием: человек
 * уже внутри и уходит отсюда по меню. Без каркаса — карточкой, как вход:
 * такого раздела нет ни у одного адреса, или упал сам каркас.
 */

export interface FallbackHome {
  readonly href: string;
  readonly label: string;
}

/** Подпись под знаком, когда экран стоит без каркаса. */
export interface FallbackStandalone {
  readonly eyebrow: string;
}

export interface FallbackFrameProps {
  readonly icon: IconName;
  readonly title: string;
  readonly text: string;
  /** Строка под текстом мелко: код ошибки для журнала. */
  readonly note?: ReactNode;
  readonly actions: ReactNode;
  /** Пусто — экран внутри каркаса: знак и имя там уже стоят в меню. */
  readonly standalone?: FallbackStandalone | undefined;
}

export function FallbackFrame({ icon, title, text, note, actions, standalone }: FallbackFrameProps) {
  if (!standalone) {
    return (
      <main className="page">
        <EmptyState
          icon={icon}
          title={title}
          text={text}
          action={
            <>
              {note}
              <div className="fallback__actions">{actions}</div>
            </>
          }
        />
      </main>
    );
  }

  return (
    <main className="login">
      <div className="login__card">
        <div>
          <div className="login__brand">
            <Brand />
          </div>
          <p className="login__eyebrow">{standalone.eyebrow}</p>
        </div>
        <div className="fallback">
          <h1 className="fallback__title">{title}</h1>
          <p className="fallback__text">{text}</p>
          {note}
        </div>
        <div className="fallback__actions fallback__actions--start">{actions}</div>
      </div>
    </main>
  );
}

/**
 * «Такой страницы нет». Ответ и на кривой адрес, и на чужую заявку: их
 * отличать нельзя — иначе перебором номеров узнаётся, какие есть.
 */
export function NotFoundScreen({
  home,
  standalone,
}: {
  readonly home: FallbackHome;
  readonly standalone?: FallbackStandalone | undefined;
}) {
  return (
    <FallbackFrame
      icon="search"
      title="Такой страницы нет"
      text="Ссылка могла устареть, а номер в адресе — оборваться при копировании."
      actions={
        <Link className="btn btn--soft" href={home.href}>
          {home.label}
        </Link>
      }
      standalone={standalone}
    />
  );
}
