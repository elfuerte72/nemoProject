import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ambassadorOrNull } from '@/lib/ambassador';
import { viewerOrNull } from '@/lib/auth';
import { entryDoors } from '@/lib/entry';
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
 * Вошедшего витрина не задерживает: живая сессия уводит в свой кабинет,
 * как страница входа уводит вошедшего мерчанта. Письма мерчанту ведут
 * на корень, и с корня он попадает в обзор, ни разу не увидев выбора,
 * которого перед ним нет.
 */
export default async function EntryPage() {
  if (await viewerOrNull()) {
    redirect('/dashboard');
  }
  if (await ambassadorOrNull()) {
    redirect('/ambassador');
  }

  return (
    <Entry
      doors={entryDoors({
        botUsername: process.env.TELEGRAM_BOT_USERNAME,
        botTokenSet: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      })}
    />
  );
}
