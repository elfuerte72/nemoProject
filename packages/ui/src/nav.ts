/**
 * Меню рабочего интерфейса: из чего оно состоит и что помнит браузер.
 *
 * Сам список разделов живёт в приложении — у панели свой, у кабинета
 * свой, — а здесь только форма списка и правила, общие обоим: какой
 * раздел считать текущим и какие группы свёрнуты. Правила эти
 * проверяются тестом, потому что ломаются они молча: свёрнутая группа с
 * текущим разделом прячет подсветку места, где человек находится, и
 * заметить это можно только глазами.
 */

import type { IconName } from './icons.js';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  /** Какой счётчик показывать рядом с названием. Ключ в наборе счётчиков. */
  readonly count?: string | undefined;
}

export interface NavGroup {
  /** Ключ группы: по нему запоминается свёртка. Не меняется при переименовании. */
  readonly key: string;
  readonly title: string;
  readonly items: readonly NavItem[];
}

/** Сколько работы ждёт за разделом. Ключи — те, что названы у пунктов. */
export type NavCountMap = Readonly<Record<string, number>>;

/**
 * Текущий раздел — по адресу. Корень отмечается только на самом корне:
 * иначе он подсвечен всегда, потому что с него начинается любой адрес.
 * Остальные разделы — с вложенными страницами: карточка заявки
 * принадлежит своему разделу.
 */
export function isCurrentSection(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/**
 * Свёрнутые группы из строки хранилища. Всё, что не список строк, —
 * пустой набор: испорченная запись не должна ронять меню, а незнакомые
 * ключи безвредны — группы с таким ключом просто нет.
 */
export function parseCollapsed(raw: string | null | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((one): one is string => typeof one === 'string'));
  } catch {
    return new Set();
  }
}

export function serializeCollapsed(collapsed: ReadonlySet<string>): string {
  return JSON.stringify([...collapsed]);
}

export function toggleCollapsed(collapsed: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(collapsed);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
