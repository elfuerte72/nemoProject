/**
 * Значки рабочих интерфейсов: панели менеджера и кабинета мерчанта.
 *
 * Рисуются здесь, а не тянутся пакетом: их два десятка, и каждый — две
 * строки разметки. Зависимость с сотней значков стоила бы дороже, а
 * общий штрих у своих значков держится сам собой.
 *
 * Набор один на оба приложения: разделы у них разные, а язык знаков
 * общий — «ключ» у мерчанта и «ключ» у сотрудника рисуются одинаково,
 * иначе это два разных сервиса.
 */

export type IconName =
  | 'exchange'
  | 'swap'
  | 'withdrawal'
  | 'card'
  | 'chat'
  | 'settings'
  | 'log'
  | 'account'
  | 'chart'
  | 'search'
  | 'chevron'
  | 'logout'
  | 'user'
  | 'question'
  | 'inbox'
  | 'spark'
  | 'home'
  | 'key'
  | 'plug'
  | 'book'
  | 'plus'
  | 'pie'
  | 'history'
  | 'shield';

export function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'exchange':
      return (
        <svg {...common}>
          <path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5" />
        </svg>
      );
    /*
     * Разворот направления: две стрелки навстречу друг другу по
     * вертикали — строки калькулятора стоят одна над другой, и
     * горизонтальный знак обмена показывал бы не тот жест. Тот же
     * контур, что у `SwapIcon` в Mini App: знак один на оба экрана.
     */
    case 'swap':
      return (
        <svg {...common}>
          <path d="M8 4.5v15M8 19.5 4.5 16M16 19.5v-15M16 4.5 19.5 8" />
        </svg>
      );
    case 'withdrawal':
      return (
        <svg {...common}>
          <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
          <path d="M4 19h16" />
        </svg>
      );
    case 'card':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M3 10h18M7 15h3" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M4 5h16v11H9l-5 4z" />
          <path d="M8 10h8" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4" />
        </svg>
      );
    case 'account':
      return (
        <svg {...common}>
          <path d="M4 10 12 4l8 6" />
          <path d="M6 10v8m4-8v8m4-8v8m4-8v8" />
          <path d="M4 20h16" />
        </svg>
      );
    case 'log':
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M9 12h7M9 16h7M9 8h3" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.2-4.2" />
        </svg>
      );
    case 'chevron':
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case 'logout':
      return (
        <svg {...common}>
          <path d="M10 4H5v16h5" />
          <path d="M14 8l4 4-4 4M9 12h9" />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" />
        </svg>
      );
    case 'question':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01" />
        </svg>
      );
    case 'inbox':
      return (
        <svg {...common}>
          <path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" />
          <path d="M4 13h4l2 3h4l2-3h4v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...common}>
          <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...common}>
          <path d="M4 16l4-6 4 3 4-7 4 4" />
        </svg>
      );
    case 'home':
      return (
        <svg {...common}>
          <path d="M4 11 12 4l8 7" />
          <path d="M6 10v10h12V10" />
        </svg>
      );
    case 'key':
      return (
        <svg {...common}>
          <circle cx="8" cy="12" r="4" />
          <path d="M12 12h9m-3 0v3m-2-3v2" />
        </svg>
      );
    case 'plug':
      return (
        <svg {...common}>
          <path d="M6 4v6a6 6 0 0 0 12 0V4" />
          <path d="M9 4v3m6-3v3M12 16v4" />
        </svg>
      );
    case 'book':
      return (
        <svg {...common}>
          <path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
          <path d="M8 8h6M8 12h6" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'history':
      // Циферблат со стрелкой назад: «что было» — изменения, прошлые входы.
      return (
        <svg {...common}>
          <path d="M4 12a8 8 0 1 0 2.3-5.6" />
          <path d="M4 4v3.5h3.5M12 8v4l2.5 2" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'pie':
      return (
        <svg {...common}>
          <path d="M20 13.5A8 8 0 1 1 10.5 4" />
          <path d="M14 3.5A7 7 0 0 1 20.5 10H14z" />
        </svg>
      );
  }
}
