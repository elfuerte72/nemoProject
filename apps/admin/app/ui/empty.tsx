import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/app/ui/icons';

/**
 * Пустое состояние, которое учит.
 *
 * Говорит, что здесь будет и откуда оно придёт, а не «данных нет»:
 * пустой экран — первое, что видит новый менеджер, и объяснять
 * устройство работы словами приходится один раз, дальше договаривает
 * панель. Действие — там, где есть что сделать прямо сейчас.
 */
export function EmptyState({
  icon = 'inbox',
  title,
  text,
  action,
}: {
  icon?: IconName;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty empty--rich">
      <span className="empty__icon" aria-hidden>
        <Icon name={icon} size={20} />
      </span>
      <p className="empty__title">{title}</p>
      {text ? <p className="empty__text">{text}</p> : undefined}
      {action}
    </div>
  );
}
