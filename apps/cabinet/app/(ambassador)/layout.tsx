import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Brand, Sidebar, Topbar } from '@nemo/ui';
import { TZ_COOKIE } from '@nemo/ui/period';
import { AMBASSADOR_NAV_COLLAPSED_KEY, AMBASSADOR_NAV_GROUPS } from '@/lib/nav';
import { ambassadorScreen } from '@/lib/ambassador';
import { DOORS_PATH } from '@/lib/entry';
import { ambassadorViewer } from '@/lib/ambassador-reads';
import { supportUsername } from '@/lib/reads';
import { StateScreen } from '@/app/ui/state-screen';

export const dynamic = 'force-dynamic';

/**
 * Каркас кабинета амбассадора: те же детали, что у мерчанта, — меню,
 * шапка, раздел под ней, — и свой состав разделов.
 *
 * Отказы здесь двух родов, и отвечают им по-разному. Не вошёл — на
 * витрину: там дверь, в которую ему и нужно. Вошёл, а отметки нет или
 * она снята — экран «вас нет в программе» со ссылкой на поддержку, тем
 * же способом, каким кабинет отвечает нерассмотренной анкете мерчанта.
 * Право входа при этом решает ядро, а не эта страница.
 */
export default async function AmbassadorLayout({ children }: { children: ReactNode }) {
  let session;
  try {
    session = (await ambassadorViewer()).session;
  } catch (error) {
    const screen = ambassadorScreen(error);
    // Не вошёл — на витрину: там дверь, в которую ему и нужно.
    if (screen === 'entry') redirect(DOORS_PATH);
    if (screen === 'not-in-program') return await notInProgram();
    throw error;
  }

  return (
    <div className="shell" data-theme="light">
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
          afterLogout={DOORS_PATH}
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
      signOut={{ path: '/api/auth/ambassador/logout', after: DOORS_PATH }}
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
