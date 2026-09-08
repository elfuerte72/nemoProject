/**
 * Карта разделов панели и память о свёрнутых группах меню.
 *
 * Список пунктов лежит здесь, а не в разметке меню: раздел заводится
 * одной строкой массива, и та же карта пригодится палитре быстрого
 * перехода — двух списков разделов у панели быть не должно. Форма
 * списка и правила меню — общие с кабинетом мерчанта и живут в
 * `@nemo/ui`.
 *
 * Разделы администратора видны всем. Скрывать их значило бы полагаться
 * на то, что менеджер не наберёт адрес руками, — это не разграничение
 * доступа, а его видимость; отказывают сами операции.
 */

import type { NavGroup, NavItem } from '@nemo/ui/nav';

/**
 * Счётчики очередей в меню. Тип, а не интерфейс: меню принимает набор
 * счётчиков по ключу, и интерфейс к такому набору не приводится.
 */
export type NavCounts = {
  readonly exchange: number;
  readonly withdrawals: number;
  readonly cards: number;
  /** Клиенты, ждущие ответа: столько же работы, сколько в очередях. */
  readonly conversations: number;
  /** Анкеты мерчантов на рассмотрении: пока не рассмотрены — ничего не могут. */
  readonly merchants: number;
};

/**
 * Пункт панели называет счётчик из своего набора, а не любую строку:
 * опечатка в ключе означала бы пункт, у которого счётчик не появится
 * никогда, и заметить это можно только глазами.
 */
interface PanelNavItem extends NavItem {
  readonly count?: keyof NavCounts | undefined;
}

interface PanelNavGroup extends NavGroup {
  readonly items: readonly PanelNavItem[];
}

export const NAV_GROUPS: readonly PanelNavGroup[] = [
  {
    key: 'work',
    title: 'Основное',
    items: [
      { href: '/', label: 'Обмен', icon: 'exchange', count: 'exchange' },
      { href: '/withdrawals', label: 'Вывод', icon: 'withdrawal', count: 'withdrawals' },
      { href: '/card-applications', label: 'Карты', icon: 'card', count: 'cards' },
      { href: '/conversations', label: 'Обращения', icon: 'chat', count: 'conversations' },
      { href: '/clients', label: 'Клиенты', icon: 'user' },
      { href: '/merchants', label: 'Мерчанты', icon: 'account', count: 'merchants' },
    ],
  },
  {
    key: 'admin',
    title: 'Администратор',
    items: [
      { href: '/analytics', label: 'Аналитика', icon: 'chart' },
      { href: '/referral', label: 'Рефералка', icon: 'spark' },
      { href: '/service-accounts', label: 'Счета сервиса', icon: 'account' },
      { href: '/settings', label: 'Настройки', icon: 'settings' },
      { href: '/requisite-access', label: 'Журнал доступа', icon: 'log' },
    ],
  },
];

/**
 * Подразделы настроек. Один экран на восемь карточек до 4 сентября 2026
 * читался прокруткой: администратор, пришедший закрыть направление,
 * листал ставки и сотрудников. У каждого подраздела свой адрес — на него
 * можно сослаться в переписке с коллегой.
 */
export interface SettingsSection {
  readonly href: string;
  readonly label: string;
  /** Что здесь настраивают — строкой под заголовком. */
  readonly sub: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    href: '/settings/economy',
    label: 'Экономика',
    sub: 'Наценка, минимум обмена и срок оплаты.',
  },
  {
    href: '/settings/referral',
    label: 'Рефералка',
    sub: 'Линии и базовые ставки, уровни, личные ставки в карточке клиента, порог вывода.',
  },
  {
    href: '/settings/pricing',
    label: 'Направления и комиссии',
    sub: 'Что сервис меняет, по каким ступеням берёт и в какие сети отправляет.',
  },
  {
    href: '/settings/concierge',
    label: 'Помощник',
    sub: 'Сколько отвечает за сутки и что знает о сервисе.',
  },
  {
    href: '/settings/merchants',
    label: 'Мерчанты',
    sub: 'Куда мерчанты пишут за помощью.',
  },
  {
    href: '/settings/staff',
    label: 'Сотрудники',
    sub: 'Кто заведён, роли, доступ и второй фактор.',
  },
  {
    href: '/settings/broadcasts',
    label: 'Рассылка',
    sub: 'Сообщение всем, кто дал согласие, и что ушло раньше.',
  },
  {
    href: '/settings/log',
    label: 'Журнал',
    sub: 'Кто и когда что менял.',
  },
];

/** Ключ в хранилище браузера. Личная настройка: коллег не касается. */
export const NAV_COLLAPSED_KEY = 'nemo.admin.nav.collapsed';
