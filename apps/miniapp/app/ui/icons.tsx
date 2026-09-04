/**
 * Иконки интерфейса.
 *
 * Рисуются здесь, а не подключаются пакетом: их полтора десятка, все
 * заданы макетом и держатся на одной сетке 24×24 с обводкой 1.6–1.8.
 * Библиотека дала бы сотни чужих штрихов и ни одного нужного.
 *
 * Цвет везде `currentColor` — состояние задаёт родитель, иконка о нём
 * не знает.
 */

import { TOBEE_HONEY, TOBEE_MARK_BRACE, TOBEE_MARK_CELL } from '@nemo/brand';

interface IconProps {
  readonly size?: number;
}

/*
 * Контур знака живёт в `@nemo/brand`, а здесь только повторяется: рисуют
 * его трое — этот компонент, заставка и панель менеджера, — и правок о
 * том, как выглядит знак, должна быть одна.
 */
export { TOBEE_MARK_BOX, TOBEE_MARK_BRACE, TOBEE_MARK_CELL } from '@nemo/brand';

/**
 * Знак сервиса — для тиснения на карте и для заставки.
 *
 * Залит, а не обведён: у фирменного знака нет линии, есть тело. Обводка
 * той же фигуры на мелком размере слипается в пятно, а на крупном
 * читается как чертёж знака, а не как сам знак.
 *
 * Заливка градиентом, а не цветом: на карте, где знак с ноготь, разницы
 * не видно, а на заставке он вчетверо крупнее, и плоская медь там
 * выглядит краской. Переход тот же, что у медовых кнопок, — светлое
 * сверху, тёмное снизу, как у металлической грани.
 *
 * Сквозная середина задаётся `evenodd`, а не вторым цветом поверх: знак
 * стоит и на фоне приложения, и на пластике карты, и залитая подложка
 * выдавала бы на них квадрат.
 */
export function TobeeMark({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="tobee-honey" x1="6" y1="3" x2="18" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor={TOBEE_HONEY[0]} />
          <stop offset="0.55" stopColor={TOBEE_HONEY[1]} />
          <stop offset="1" stopColor={TOBEE_HONEY[2]} />
        </linearGradient>
      </defs>
      <g fill="url(#tobee-honey)" fillRule="evenodd">
        <path d={TOBEE_MARK_BRACE} />
        <path d={TOBEE_MARK_CELL} />
      </g>
    </svg>
  );
}

export function ExchangeIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 9.5h13l-3.2-3.2M19.5 14.5h-13l3.2 3.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WithdrawIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 16V5.5M8.4 9.1 12 5.5l3.6 3.6M5 18.5h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InviteIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4.4 13.9 10.1 19.6 12 13.9 13.9 12 19.6 10.1 13.9 4.4 12 10.1 10.1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SwapIcon({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 4.5v15M8 19.5 4.5 16M16 19.5v-15M16 4.5 19.5 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CardIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

/** Кровать под навесом: отель узнаётся по ней, а не по зданию. */
export function HotelIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 18V7M4 12h16v6M4 15h16M8.5 11.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Zm4-3.2H20"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Круг из двух стрелок — подписка: то, что списывается снова каждый
 * месяц. Не карта и не корзина: платит здесь не сервис и не клиент
 * разово, а подписка продлевается сама.
 */
export function SubscriptionIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 12a8 8 0 0 1-13.7 5.6M4 12a8 8 0 0 1 13.7-5.6M17.5 3.2v3.4h-3.4M6.5 20.8v-3.4h3.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Корзина: покупка в чужом магазине узнаётся по ней везде. */
export function CartIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 5h2.2l2 9.5h9.6l2-6.8H7.1M9.5 19.2a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Ведро с крышкой — знак удаления записи.
 *
 * Не крестик, хотя крестик короче: крестик в этом приложении закрывает
 * лист, и второй такой же в строке того же листа читался бы как «убрать
 * с экрана», а не «удалить навсегда». Ведро о безвозвратности говорит
 * само.
 */
export function TrashIcon({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 7h15M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M6.5 7l.9 11.4c.1 1 .9 1.6 1.8 1.6h5.6c.9 0 1.7-.7 1.8-1.6L17.5 7M10.3 10.7v6M13.7 10.7v6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Реплика — тем же носиком, что у знака сервиса: разговор с менеджером
 * идёт в том же чате, которым сервис и представлен.
 */
export function SupportIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 12.3c0 3.8-3.6 6.8-8 6.8-.8 0-1.6-.1-2.4-.3l-4.6 1.7 1.3-3.4A6.6 6.6 0 0 1 4 12.3c0-3.8 3.6-6.8 8-6.8s8 3 8 6.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Знаки раскрытия и перехода. Цвет у них общий и приглушённый, но задан
 * он классом, а не вписан в фигуру: вписанный, он не отзывался ни на
 * наведение, ни на выключенное состояние того, внутри чего стоит, — и
 * противоречил правилу, объявленному в шапке этого файла.
 */
export function ChevronDown({ size = 10 }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * 6) / 10}
      viewBox="0 0 10 6"
      fill="none"
      aria-hidden="true"
      className="chevron"
    >
      <path
        d="M1 1l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Крестик закрытия. Своим цветом не красится — берёт его у кнопки, в
 * которой стоит: у листа она приглушена и разгорается под пальцем.
 */
export function CloseIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M1.5 1.5l10 10M11.5 1.5l-10 10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChevronRight({ size = 8 }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * 13) / 8}
      viewBox="0 0 8 13"
      fill="none"
      aria-hidden="true"
      className="chevron"
    >
      <path
        d="M1.5 1.5 6.5 6.5l-5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Знаки нижней панели построены на одной соте — той же, что в знаке
 * бренда. Активная вкладка заливается, а не подчёркивается: полоса
 * под иконкой на 24 пикселях читается хуже, чем силуэт.
 */
function TabHex({ children, filled }: { children: React.ReactNode; filled: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.6 20 7.3V16.7L12 21.4 4 16.7V7.3Z"
        fill={filled ? 'rgba(249,160,60,.18)' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {children}
    </svg>
  );
}

export function TabExchangeIcon({ filled }: { filled: boolean }) {
  return (
    <TabHex filled={filled}>
      <path
        d="M9 10.6h6l-1.8-1.9M15 13.4H9l1.8 1.9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </TabHex>
  );
}

/**
 * Часы, а не список строк: история — это про «когда», и стопка полосок
 * на 24 пикселях не отличается от знака настроек.
 */
export function TabHistoryIcon({ filled }: { filled: boolean }) {
  return (
    <TabHex filled={filled}>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
      {/* Стрелки от центра вверх и вправо: время читается по их углу. */}
      <path
        d="M12 9.8V12l1.7 1.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </TabHex>
  );
}

/**
 * Силуэт человека: профиль — единственное место, где приложение говорит
 * о самом клиенте, и знак у него тот же, каким это принято обозначать
 * везде. Своя фигура здесь стоила бы узнаваемости.
 */
export function TabProfileIcon({ filled }: { filled: boolean }) {
  return (
    <TabHex filled={filled}>
      <circle cx="12" cy="10.1" r="2.1" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8.5 16c.5-1.7 1.8-2.6 3.5-2.6s3 .9 3.5 2.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </TabHex>
  );
}
