import { NotFoundScreen } from '@nemo/ui';

/**
 * Адрес, которого у кабинета нет вовсе. Ведёт на витрину: вошедшего она
 * сама уводит в его кабинет, мерчанта или амбассадора, а не вошедшему
 * показывает двери.
 */
export default function RootNotFound() {
  return (
    <NotFoundScreen home={{ href: '/', label: 'На главную' }} standalone={{ eyebrow: 'Кабинет' }} />
  );
}
