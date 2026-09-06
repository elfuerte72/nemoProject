import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Brand, Sidebar, Topbar } from '@nemo/ui';
import { requireViewerOrNull } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { OPEN_STATUSES } from '@/lib/labels';
import { NAV_COLLAPSED_KEY, NAV_GROUPS } from '@/lib/nav';
import { StateScreen } from '@/app/ui/state-screen';

export const dynamic = 'force-dynamic';

/**
 * Каркас кабинета: меню слева, шапка сверху, раздел под ней.
 *
 * До кабинета мерчант доходит не всегда, и решается это здесь: пока
 * почта не подтверждена или анкета не рассмотрена, показывать нечего —
 * заявок нет, ключей нет, и меню, из которого некуда идти, только
 * обещает лишнее. Вместо кабинета в этих случаях один экран и ссылка на
 * поддержку.
 *
 * Отключённый кабинет видит: открытые заявки доходят до конца, и следить
 * за ними он должен. Что ему при этом нельзя, решают операции, а не
 * спрятанные кнопки.
 */
export default async function CabinetLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewerOrNull();
  if (!viewer) {
    redirect('/login');
  }
  const { actor, session } = viewer;
  const core = getCore();
  const support = await core.merchantSupportUsername();

  if (!session.emailVerified) {
    return (
      <StateScreen
        title="Подтвердите почту"
        support={support}
        lines={[
          'Мы отправили письмо со ссылкой — по ней адрес и подтверждается. ' +
            'Пока этого не случилось, анкета не уходит на рассмотрение.',
          'Письма нет — загляните в «Спам». Ссылка живёт сутки; если она истекла, ' +
            'напишите в поддержку.',
        ]}
      />
    );
  }

  if (session.status === 'pending') {
    return (
      <StateScreen
        title="Анкета на рассмотрении"
        support={support}
        lines={[
          'Мы получили анкету и смотрим её. О решении напишем на вашу почту.',
          'Одобрение открывает кабинет целиком: заявки, ключи API и вебхуки.',
        ]}
      />
    );
  }

  if (session.status === 'rejected') {
    const profile = await core.getMerchantProfile(actor);
    return (
      <StateScreen
        title="Анкета отклонена"
        support={support}
        lines={[
          profile.rejectionReason
            ? `Причина: ${profile.rejectionReason}`
            : 'Причина не указана.',
          'Если это недоразумение или что-то изменилось — напишите в поддержку.',
        ]}
      />
    );
  }

  const active = await core.countExchangeRequests(actor, { statuses: OPEN_STATUSES });

  return (
    <div className="shell">
      <Sidebar
        groups={NAV_GROUPS}
        counts={{ active }}
        storageKey={NAV_COLLAPSED_KEY}
        brand={<Brand eyebrow="кабинет" />}
        homeLabel="Tobee, кабинет мерчанта — на обзор"
      />
      <div className="shell__main">
        <Topbar
          name={session.name}
          sub="Мерчант"
          items={[{ href: '/settings', label: 'Настройки', icon: 'settings' }]}
          logoutPath="/api/auth/logout"
          afterLogout="/login"
        />
        {children}
      </div>
    </div>
  );
}
