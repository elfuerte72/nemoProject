'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { Icon, type IconName } from './icons.js';

/**
 * Шапка над содержимым: поиск и тот, кто вошёл.
 *
 * Поиск приходит слотом: у панели это кнопка, открывающая палитру
 * быстрого перехода, у кабинета мерчанта его нет вовсе — разделов
 * дюжина, и искать в них нечего. Имя и роль — здесь, а не внизу меню:
 * шапка видна на любой странице и на любой ширине, а низ меню на
 * телефоне уезжает за край.
 */
export function Topbar({
  search,
  name,
  sub,
  items = [],
  logoutPath,
  afterLogout,
  timeZoneCookie,
}: {
  readonly search?: ReactNode;
  readonly name: string;
  /** Строка под именем: роль сотрудника, название мерчанта. */
  readonly sub: string;
  readonly items?: readonly { href: string; label: string; icon: IconName }[];
  readonly logoutPath: string;
  readonly afterLogout: string;
  /**
   * Куда класть смещение часового пояса. Не задано — «сегодня» на
   * сервере считается по UTC, и кабинету, где дат нет, этого хватает.
   */
  readonly timeZoneCookie?: string | undefined;
}) {
  /*
   * Смещение часового пояса — в куку: «сегодня» на сервере считается по
   * нему, а сервер живёт в UTC. Шапка есть на каждой странице, поэтому
   * кука появляется с первого же экрана, какой бы он ни был.
   */
  useEffect(() => {
    if (!timeZoneCookie) return;
    const year = 60 * 60 * 24 * 365;
    document.cookie = `${timeZoneCookie}=${-new Date().getTimezoneOffset()}; path=/; max-age=${year}; samesite=lax`;
  }, [timeZoneCookie]);

  return (
    <header className="topbar">
      {search}

      <span className="topbar__spacer" />

      {/*
        Меню на `details`: открывается и закрывается без состояния,
        а клавиатура и экранный диктор получают его бесплатно.
      */}
      <details className="menu">
        <summary className="menu__summary" aria-label={`${name}, ${sub}`}>
          <span className="menu__avatar" aria-hidden>
            {initial(name)}
          </span>
          <span className="menu__who">
            <span className="menu__name">{name}</span>
            <span className="menu__role">{sub}</span>
          </span>
          <span className="menu__chevron" aria-hidden>
            <Icon name="chevron" size={14} />
          </span>
        </summary>
        <div className="menu__list">
          {items.map((item) => (
            <Link key={item.href} href={item.href} className="menu__item">
              <Icon name={item.icon} size={15} />
              {item.label}
            </Link>
          ))}
          {/*
            Кнопка, а не ссылка: выход меняет состояние, и срабатывать он
            должен по нажатию — а не от предзагрузки соседней вкладки.
            Переход адресом, а не router: после снятия куки нужен свежий
            запрос, иначе разделы приедут из кэша уже закрытой сессии.
          */}
          <button
            type="button"
            className="menu__item menu__item--danger"
            onClick={() => {
              void signOut(logoutPath, afterLogout);
            }}
          >
            <Icon name="logout" size={15} />
            Выйти
          </button>
        </div>
      </details>
    </header>
  );
}

async function signOut(logoutPath: string, afterLogout: string): Promise<void> {
  await fetch(logoutPath, { method: 'POST' });
  window.location.href = afterLogout;
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '·';
}
