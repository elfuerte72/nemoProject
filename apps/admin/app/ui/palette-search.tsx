'use client';

import { useCallback, useState } from 'react';
import { Icon } from '@nemo/ui';
import { Palette, usePaletteHotkey } from '@/app/ui/palette';

/**
 * Поиск в шапке панели — кнопка, открывающая палитру быстрого перехода:
 * та же палитра открывается ⌘K с любого места страницы.
 *
 * Живёт у панели, а не в общей шапке: у кабинета мерчанта искать нечего
 * — разделов дюжина, а заявки он ищет в своём разделе, — и шапка
 * принимает поиск слотом, чтобы не тащить палитру туда, где её нет.
 */
export function PaletteSearch() {
  const [open, setOpen] = useState(false);
  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);
  usePaletteHotkey(openPalette);

  return (
    <>
      <button type="button" className="topbar__search" onClick={openPalette}>
        <Icon name="search" size={15} />
        <span className="topbar__placeholder">Заявка, ник или ID клиента</span>
        <kbd className="topbar__kbd" aria-hidden>
          ⌘K
        </kbd>
      </button>
      <Palette open={open} onClose={closePalette} />
    </>
  );
}
