'use client';

import Link from 'next/link';
import type { StaffRole } from '@nemo/types';
import { ROLE_LABELS } from '@/lib/labels';
import { Icon } from '@/app/ui/icons';

/**
 * Шапка над содержимым: поиск и тот, кто вошёл.
 *
 * Поиск — обычная форма на рабочий стол: набранное уходит параметром
 * `q`, тем самым, которым стол сужает очередь. Палитра быстрого
 * перехода встанет на это же место, и форма останется запасным путём
 * без JavaScript.
 *
 * Имя и роль — здесь, а не внизу меню: шапка видна на любой странице и
 * на любой ширине, а низ меню на телефоне уезжает за край.
 */
export function Topbar({ displayName, role }: { displayName: string; role: StaffRole }) {
  return (
    <header className="topbar">
      <form className="topbar__search" action="/" method="get" role="search">
        <Icon name="search" size={15} />
        <input
          name="q"
          type="search"
          placeholder="Поиск по нику или ID клиента"
          aria-label="Поиск по нику или ID клиента"
          autoComplete="off"
        />
        <kbd className="topbar__kbd" aria-hidden>
          ⌘K
        </kbd>
      </form>

      <span className="topbar__spacer" />

      {/*
        Меню на `details`: открывается и закрывается без состояния,
        а клавиатура и экранный диктор получают его бесплатно.
      */}
      <details className="menu">
        <summary className="menu__summary" aria-label={`${displayName}, ${ROLE_LABELS[role]}`}>
          <span className="menu__avatar" aria-hidden>
            {initial(displayName)}
          </span>
          <span className="menu__who">
            <span className="menu__name">{displayName}</span>
            <span className="menu__role">{ROLE_LABELS[role]}</span>
          </span>
          <span className="menu__chevron" aria-hidden>
            <Icon name="chevron" size={14} />
          </span>
        </summary>
        <div className="menu__list">
          <Link href="/settings" className="menu__item">
            <Icon name="settings" size={15} />
            Настройки
          </Link>
          {/*
            Кнопка, а не ссылка: выход меняет состояние, и срабатывать он
            должен по нажатию — а не от предзагрузки соседней вкладки.
            Переход адресом, а не router: после снятия куки нужен свежий
            запрос, иначе разделы приедут из кэша уже закрытой сессии.
          */}
          <button type="button" className="menu__item menu__item--danger" onClick={signOut}>
            <Icon name="logout" size={15} />
            Выйти
          </button>
        </div>
      </details>
    </header>
  );
}

async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '·';
}
