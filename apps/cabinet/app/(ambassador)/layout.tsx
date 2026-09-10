import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Brand, Sidebar, Topbar } from '@nemo/ui';
import { TZ_COOKIE } from '@nemo/ui/period';
import { AMBASSADOR_NAV_COLLAPSED_KEY, AMBASSADOR_NAV_GROUPS } from '@/lib/nav';
import { ambassadorViewer } from '@/lib/ambassador-reads';
import { supportUsername } from '@/lib/reads';
import { StateScreen } from '@/app/ui/state-screen';
import { isSignedOut } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Каркас кабинета амбассадора: те же детали, что у мерчанта, — меню,
 * шапка, раздел под ней, — и свой состав разделов.
 *
 * Вошедшего без отметки сюда не приводят: право входа решает ядро, и
 * снятому оно откажет на первом же запросе. Отказ этот означает не
 * «войдите заново», а «вас нет в программе» — и говорится словами, тем
 * же экраном, каким кабинет отвечает нерассмотренной анкете мерчанта.
 */
export default async function AmbassadorLayout({ children }: { children: ReactNode }) {
  let session;
  try {
    session = (await ambassadorViewer()).session;
  } catch (error) {
    if (!isSignedOut(error)) throw error;
    return await notInProgram();
  }

  return (
    <div className="shell">
      <Sidebar
        groups={AMBASSADOR_NAV_GROUPS}
        counts={{}}
        storageKey={AMBASSADOR_NAV_COLLAPSED_KEY}
        brand={<Brand eyebrow="амбассадор" />}
        homeHref="/ambassador"
        homeLabel="Tobee, кабинет амбассадора — на обзор"
      />
      <div className="shell__main">
        <Topbar
          name={session.title}
          sub="Амбассадор"
          logoutPath="/api/auth/ambassador/logout"
          afterLogout="/"
          timeZoneCookie={TZ_COOKIE}
        />
        {children}
      </div>
    </div>
  );
}

/**
 * Вошёл, а отметки нет: подпись Telegram подтвердила аккаунт, но право
 * даёт не она. Отдельного экрана «войдите» здесь не бывает — тот, кто
 * дошёл до этой страницы, вход уже прошёл.
 */
async function notInProgram(): Promise<ReactNode> {
  return (
    <StateScreen
      title="Вас нет в программе"
      eyebrow="амбассадор"
      signOut={{ path: '/api/auth/ambassador/logout', after: '/' }}
      support={await supportUsername()}
      lines={[
        'Кабинет амбассадора открыт тем, кого сервис позвал в программу поимённо: каналам, ' +
          'чатам и блогерам, с которыми договорились об условиях.',
        'Если договаривались и с вами — напишите нам: скажем, каким аккаунтом входить, или ' +
          'заведём отметку на этот.',
      ]}
    />
  );
}
