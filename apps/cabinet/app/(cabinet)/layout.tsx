import type { ReactNode } from 'react';
import type { MerchantSession } from '@nemo/core';
import { Brand, Sidebar, Topbar } from '@nemo/ui';
import { TZ_COOKIE } from '@nemo/ui/period';
import type { MerchantActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { NAV_COLLAPSED_KEY, NAV_GROUPS } from '@/lib/nav';
import { openCount, requestCounts, supportUsername, viewer } from '@/lib/reads';
import { ResendVerification } from '@/app/ui/resend-verification';
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
  const { actor, session } = await viewer();

  // Ник поддержки нужен только экранам состояния: активному кабинету он
  // не показывается, и спрашивать его на каждой странице незачем.
  if (session.status !== 'active' && session.status !== 'disabled') {
    return await stateScreen(session, actor);
  }

  const counts = await requestCounts();

  return (
    <div className="shell">
      <Sidebar
        groups={NAV_GROUPS}
        counts={{ active: openCount(counts) }}
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
          timeZoneCookie={TZ_COOKIE}
        />
        {children}
      </div>
    </div>
  );
}

/**
 * Вместо кабинета — один экран: почта не подтверждена, анкета на
 * рассмотрении или отклонена.
 */
async function stateScreen(
  session: MerchantSession,
  actor: MerchantActor,
): Promise<ReactNode> {
  const support = await supportUsername();

  if (!session.emailVerified) {
    return (
      <StateScreen
        title="Подтвердите почту"
        support={support}
        lines={[
          'Мы отправили письмо со ссылкой — по ней адрес и подтверждается. ' +
            'Пока этого не случилось, анкета не уходит на рассмотрение.',
          'Письма нет — загляните в «Спам». Ссылка живёт сутки; если она истекла ' +
            'или письмо потерялось, вышлем новое.',
        ]}
        action={<ResendVerification />}
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

  // Осталось одно состояние — отклонена: активного и отключённого сюда
  // не приводят, они видят кабинет.
  const profile = await getCore().getMerchantProfile(actor);
  return (
    <StateScreen
      title="Анкета отклонена"
      support={support}
      lines={[
        profile.rejectionReason ? `Причина: ${profile.rejectionReason}` : 'Причина не указана.',
        'Если это недоразумение или что-то изменилось — напишите в поддержку.',
      ]}
    />
  );
}
