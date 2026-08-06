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

interface IconProps {
  readonly size?: number;
}

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
          <stop stopColor="#FFCF7D" />
          <stop offset="0.55" stopColor="#FBAA48" />
          <stop offset="1" stopColor="#F79A33" />
        </linearGradient>
      </defs>
      <g fill="url(#tobee-honey)" fillRule="evenodd">
        {/* Верхняя скоба. */}
        <path d="M12.51 5.16 15.99 7.6Q16.44 7.92 16.44 8.47L16.44 9.3Q16.44 9.6 16.19 9.43L12.41 6.88Q12 6.6 11.59 6.88L7.81 9.43Q7.56 9.6 7.56 9.3L7.56 8.47Q7.56 7.92 8.01 7.6L11.49 5.16Q12 4.8 12.51 5.16Z" />
        {/* Сота с носиком реплики и сквозной серединой. */}
        <path d="M12.56 8.34 15.96 10.92Q16.44 11.28 16.44 11.88L16.44 13.8Q16.44 14.4 15.96 14.77L13.28 16.83Q13 17.04 13 17.39L13 18.76Q13 18.96 12.85 18.83L8.02 14.79Q7.56 14.4 7.56 13.8L7.56 11.88Q7.56 11.28 8.04 10.92L11.44 8.34Q12 7.92 12.56 8.34ZM12.96 10.9 14.04 11.96Q15 12.9 14.04 13.84L12.96 14.9Q12 15.84 11.04 14.9L9.96 13.84Q9 12.9 9.96 11.96L11.04 10.9Q12 9.96 12.96 10.9Z" />
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

export function ChevronDown({ size = 10 }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * 6) / 10}
      viewBox="0 0 10 6"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1 1l4 4 4-4"
        stroke="#928BAB"
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
    >
      <path
        d="M1.5 1.5 6.5 6.5l-5 5"
        stroke="#6F688A"
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
