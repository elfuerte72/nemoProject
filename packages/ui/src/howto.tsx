import type { ReactNode } from 'react';
import { Icon } from './icons.js';

/**
 * Подсказка «как устроено» — свёрнутый блок под заголовком раздела.
 *
 * Объясняет правила, а не кнопки: что это, какие бывают состояния и что
 * они значат, кто что решает, чего здесь не делать. Тексты живут в коде
 * рядом с экраном, а не в вики: вики расходится с интерфейсом через
 * месяц, и первым это замечает тот, кто по ней работает.
 *
 * Свёрнута по умолчанию и не требует закрытия: тур, встающий поперёк
 * работы, закрывают не читая — и второй раз уже не открывают.
 *
 * Объяснение бывает не только словами: табло курсов показывает путь
 * денег на живых числах, и абзацы у него идут после показа. Для этого
 * блок принимает разметку детьми — она встаёт первой, а пункты, если
 * они есть, следом.
 */

export interface HowToItem {
  readonly title: string;
  readonly detail: string;
}

export function HowTo({
  title,
  sub,
  items = [],
  ordered = false,
  children,
}: {
  title: string;
  sub: string;
  items?: readonly HowToItem[];
  /** Шаги по порядку нумеруются; правила, у которых порядка нет, — нет. */
  ordered?: boolean;
  /** Показ перед словами: схема, путь, пример на живых числах. */
  children?: ReactNode;
}) {
  return (
    <details className="howto">
      <summary className="howto__head">
        <span className="howto__mark" aria-hidden>
          <Icon name="question" size={15} />
        </span>
        <span className="howto__heading">
          <span className="howto__title">{title}</span>
          <span className="howto__sub">{sub}</span>
        </span>
        <span className="howto__chevron" aria-hidden>
          <Icon name="chevron" size={16} />
        </span>
      </summary>
      {children ? <div className="howto__show">{children}</div> : undefined}
      {items.length > 0 ? (
        <div className={ordered ? 'howto__body howto__body--ordered' : 'howto__body'}>
          {items.map((item) => (
            <div key={item.title} className="howto__item">
              <span className="howto__item-title">{item.title}</span>
              <span className="howto__item-detail">{item.detail}</span>
            </div>
          ))}
        </div>
      ) : undefined}
    </details>
  );
}
