import type { Metadata } from 'next';
import { ForgotForm } from './forgot-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Забыли пароль — кабинет Tobee' };

export default function ForgotPage() {
  return <ForgotForm />;
}
