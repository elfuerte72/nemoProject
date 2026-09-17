import { NotFoundScreen } from '@nemo/ui';

/**
 * «Такой страницы нет» под меню кабинета: заявка с кривым номером и
 * чужая заявка отвечают одинаково — отличать одно от другого значило бы
 * подтверждать, что чужая есть.
 */
export default function CabinetNotFound() {
  return <NotFoundScreen home={{ href: '/dashboard', label: 'На обзор' }} />;
}
