import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { viewerOrNull } from '@/lib/auth';
import { RegisterForm } from './register-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Заведение кабинета — Tobee' };

/**
 * Заведение кабинета. Вошедшего сюда не пускают — как и на вход: вторая
 * анкета поверх живой сессии заканчивалась кнопкой «К входу», которая
 * возвращала в прежний кабинет, и человек не понимал, куда делась новая.
 */
export default async function RegisterPage() {
  if (await viewerOrNull()) {
    redirect('/dashboard');
  }
  return <RegisterForm />;
}
