/**
 * Детали рабочих интерфейсов Tobee: панели менеджера и кабинета
 * мерчанта.
 *
 * Здесь то, что у них общее целиком — плитка показателя, табы, ряд
 * списка, подсказка «как устроено», меню, шапка, знак, время в часах
 * браузера. Своё каждое приложение держит у себя: у панели это очередь,
 * палитра и переписка, у кабинета — его разделы.
 *
 * Оформление к этим деталям — в `@nemo/ui/styles.css`; подключается оно
 * первым, до собственного `globals.css` приложения.
 */

export { Brand, TobeeMark } from './brand.js';
export { CopyValue } from './copy.js';
export { EmptyState } from './empty.js';
export { HowTo, type HowToItem } from './howto.js';
export { Icon, type IconName } from './icons.js';
export { Moment, useBrowserZone } from './moment.js';
export {
  isCurrentSection,
  parseCollapsed,
  serializeCollapsed,
  toggleCollapsed,
  type NavCountMap,
  type NavGroup,
  type NavItem,
} from './nav.js';
export { Sidebar } from './sidebar.js';
export { Stat, Stats, type StatTone } from './stat.js';
export { Tabs, type TabItem } from './tabs.js';
export { Topbar } from './topbar.js';
export {
  dayKey,
  formatAmount,
  formatDay,
  formatDayHeading,
  formatMoment,
  formatMoney,
  formatRate,
  formatTime,
} from './format.js';
