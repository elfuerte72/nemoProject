import type { Metadata } from 'next';
import { RegisterForm } from './register-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Заведение кабинета — Tobee' };

export default function RegisterPage() {
  return <RegisterForm />;
}
