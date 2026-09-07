import type { Metadata } from 'next';
import { ResetForm } from './reset-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Новый пароль — кабинет Tobee' };

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ResetForm token={token ?? ''} />;
}
