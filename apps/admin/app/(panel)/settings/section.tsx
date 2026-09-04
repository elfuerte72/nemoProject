import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { CoreError } from '@nemo/core';
import { requireStaffActorOrNull, type StaffActor } from '@/lib/auth/require-session';
import { SETTINGS_SECTIONS } from '@/lib/nav';

/**
 * Общее у страниц настроек: кто смотрит, строка под подменю и отказ
 * менеджеру.
 *
 * Менеджеру раздел не показывается вовсе — но не потому, что скрыт:
 * каждая операция здесь сама отказывает не-администратору. Скрытая
 * ссылка без такого отказа была бы не разграничением доступа, а его
 * видимостью. Менеджер сюда заходит по прямой ссылке: показываем
 * отказ, а не страницу входа — войти он как раз может, просто не сюда.
 */
export async function settingsActor(): Promise<StaffActor> {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }
  return actor;
}

/** Строка о подразделе — из той же карты, что и подменю. */
export function SectionLead({ href }: { readonly href: string }) {
  const section = SETTINGS_SECTIONS.find((one) => one.href === href);
  return section ? <p className="card__note">{section.sub}</p> : undefined;
}

/**
 * Страница подраздела: собирает данные, а на отказ ядра отвечает
 * словами вместо страницы аварии.
 */
export async function SettingsSection({
  load,
}: {
  readonly load: () => Promise<ReactNode>;
}) {
  try {
    return <>{await load()}</>;
  } catch (error) {
    if (error instanceof CoreError && error.code === 'forbidden') {
      return (
        <p className="empty">
          Раздел доступен только администратору: здесь задаются ставки, наценка и доступ
          сотрудников. Если он нужен вам по работе — попросите администратора.
        </p>
      );
    }
    throw error;
  }
}
