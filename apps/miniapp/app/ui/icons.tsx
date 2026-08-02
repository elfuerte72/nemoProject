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

export function NemoMark({ size = 30 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 1.9 20.7 6.9V16.9L12 21.9 3.3 16.9V6.9Z" fill="url(#nemo-mark-gold)" />
      <path
        d="M9.4 15.6V8.4l5.2 7.2V8.4"
        stroke="#14120E"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="nemo-mark-gold" x1="3" y1="2" x2="21" y2="22">
          <stop stopColor="#F3E3BE" />
          <stop offset=".55" stopColor="#C9A66B" />
          <stop offset="1" stopColor="#8C6F3E" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Тот же знак обводкой — для тиснения на карте. */
export function NemoOutline({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 1.9 20.7 6.9V16.9L12 21.9 3.3 16.9V6.9Z"
        stroke="#D9BE86"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9.4 15.6V8.4l5.2 7.2V8.4"
        stroke="#D9BE86"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function QuestionIcon({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9.2 9.2a2.9 2.9 0 1 1 3.8 2.75c-.6.2-.9.75-.9 1.35v.9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.6" r="1.15" fill="currentColor" />
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
        stroke="#96918A"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
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
        stroke="#7E796F"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Знаки нижней панели построены на одном шестиугольнике — том же, что в
 * знаке бренда. Активная вкладка заливается, а не подчёркивается: полоса
 * под иконкой на 24 пикселях читается хуже, чем силуэт.
 */
function TabHex({ children, filled }: { children: React.ReactNode; filled: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.6 20 7.3V16.7L12 21.4 4 16.7V7.3Z"
        fill={filled ? 'rgba(217,190,134,.16)' : 'none'}
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

export function TabBonusIcon({ filled }: { filled: boolean }) {
  return (
    <TabHex filled={filled}>
      <path d="M8.3 10.3h7.4L12 16Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </TabHex>
  );
}

export function TabCardIcon({ filled }: { filled: boolean }) {
  return (
    <TabHex filled={filled}>
      <path d="M5.1 10.2h13.8M9 14.4h3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </TabHex>
  );
}
