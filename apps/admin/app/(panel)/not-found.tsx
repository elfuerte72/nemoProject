import { NotFoundScreen } from '@nemo/ui';

/**
 * «Такой страницы нет» под меню панели: заявка, мерчант или клиент с
 * номером, которого нет или который набран с ошибкой. Меню остаётся на
 * месте — уйти отсюда можно в любой раздел, а не только на стол.
 */
export default function PanelNotFound() {
  return <NotFoundScreen home={{ href: '/', label: 'На рабочий стол' }} />;
}
