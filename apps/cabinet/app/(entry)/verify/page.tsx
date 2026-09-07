import type { Metadata } from 'next';
import { VerifyForm } from './verify-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Подтверждение почты — кабинет Tobee' };

/**
 * Подтверждение адреса по ссылке из письма.
 *
 * Ключ тратится нажатием, а не открытием страницы: по ссылке из письма
 * ходит не только человек — почтовые шлюзы открывают её заранее, проверяя
 * на вредоносность, и одноразовый ключ сгорал бы до того, как мерчант
 * увидит письмо. Тем же правилом живёт сброс пароля.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <VerifyForm token={token ?? ''} />;
}
