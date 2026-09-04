import { redirect } from 'next/navigation';
import { SETTINGS_SECTIONS } from '@/lib/nav';

/**
 * «Настройки» без подраздела — первый из них. Адрес остаётся в меню и
 * в закладках: ссылка на `/settings` из переписки не должна умереть.
 */
export default function SettingsPage() {
  redirect(SETTINGS_SECTIONS[0]!.href);
}
