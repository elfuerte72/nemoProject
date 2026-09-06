import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireViewerOrNull } from '@/lib/auth';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Вход — кабинет Tobee' };

/**
 * Вход в кабинет: почта и пароль.
 *
 * Вошедшего сюда не пускают: страница входа, открытая с живой сессией,
 * выглядит как «вас выкинуло», и человек начинает вспоминать пароль там,
 * где входить не нужно.
 */
export default async function LoginPage() {
  if (await requireViewerOrNull()) {
    redirect('/');
  }
  return <LoginForm />;
}
