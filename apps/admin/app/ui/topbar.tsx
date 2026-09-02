'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import type { StaffRole } from '@nemo/types';
import { ROLE_LABELS } from '@/lib/labels';
import { Icon } from '@/app/ui/icons';
import { Palette, usePaletteHotkey } from '@/app/ui/palette';

/**
 * Шапка над содержимым: поиск и тот, кто вошёл.
 *
 * Поле поиска — кнопка, открывающая палитру быстрого перехода: та же
 * палитра открывается ⌘K с любого места страницы. Имя и роль — здесь,
 * а не внизу меню: шапка видна на любой странице и на любой ширине, а
 * низ меню на телефоне уезжает за край.
 */
export function Topbar({ displayName, role }: { displayName: string; role: StaffRole }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  usePaletteHotkey(openPalette);

  return (
    <header className="topbar">
      <button type="button" className="topbar__search" onClick={openPalette}>
        <Icon name="search" size={15} />
        <span className="topbar__placeholder">Заявка, ник или ID клиента</span>
        <kbd className="topbar__kbd" aria-hidden>
          ⌘K
        </kbd>
      </button>
      <Palette open={paletteOpen} onClose={closePalette} />

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
