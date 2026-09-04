'use client';

import { usePathname } from 'next/navigation';
import { SETTINGS_SECTIONS } from '@/lib/nav';
import { Tabs } from '@/app/ui/tabs';

/**
 * Подменю настроек: те же табы, что у состояний очереди, — выбор живёт
 * в адресе. Текущий определяется по адресу, а адрес меняется без
 * перезагрузки — потому клиентский компонент.
 */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <Tabs
      label="Подразделы настроек"
      items={SETTINGS_SECTIONS.map((section) => ({
        href: section.href,
        label: section.label,
        current: pathname.startsWith(section.href),
      }))}
    />
  );
}
