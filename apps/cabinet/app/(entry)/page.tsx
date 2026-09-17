import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ambassadorOrNull } from '@/lib/ambassador';
import { viewerOrNull } from '@/lib/auth';
import { entryDoors, entryRoute, wantsDoors } from '@/lib/entry';
import { Entry } from './entry';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Tobee — вход' };

/**
 * Витрина: одна страница на две двери.
 *
 * Отвечает на «куда мне войти», а не на «почему Tobee»: цен, отзывов и
 * рассказа о сервисе здесь нет — за ними приходят не сюда, а на домен,
 * которым сервис подписан снаружи.
 *
 * Вошедшего корень не задерживает: живая сессия уводит в свой кабинет,
 * как страница входа уводит вошедшего мерчанта. Письма мерчанту ведут
 * на корень, и с корня он попадает в обзор, ни разу не увидев выбора,
 * которого перед ним нет. Двери по ссылке (`/?doors`) не уводят никого:
 * на них выводят выход и знак на экранах входа, и дверь, в которую уже
 * вошли, говорит об этом вместо входа.
 */
export default async function EntryPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [merchant, ambassador, params] = await Promise.all([
    viewerOrNull(),
    ambassadorOrNull(),
    searchParams,
  ]);

  const route = entryRoute({
    showDoors: wantsDoors(params),
    merchant: merchant?.session.name ?? null,
    ambassador: ambassador?.session.title ?? null,
  });
  if (route.kind === 'redirect') {
    redirect(route.to);
  }

  return (
    <Entry
      doors={entryDoors({
        botUsername: process.env.TELEGRAM_BOT_USERNAME,
        botTokenSet: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      })}
      signedIn={route.signedIn}
    />
  );
}
