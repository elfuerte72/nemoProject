import type { NavIcon } from '@/lib/nav';

/**
 * Значки панели.
 *
 * Рисуются здесь, а не тянутся пакетом: их полтора десятка, и каждый —
 * две строки разметки. Зависимость с сотней значков стоила бы дороже, а
 * общий штрих у своих значков держится сам собой.
 */

export type IconName =
  | NavIcon
  | 'search'
  | 'chevron'
  | 'logout'
  | 'user'
  | 'question'
  | 'inbox'
  | 'spark';

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
  }
}
