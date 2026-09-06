import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@nemo/ui';
import { getCore } from '@/lib/core';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Подтверждение почты — кабинет Tobee' };

/**
 * Подтверждение адреса по ссылке из письма.
 *
 * Ключ забирается прямо здесь, на открытии страницы: ссылку открывают
 * из почты, и другого способа у неё нет — форму с кнопкой «подтвердить»
 * человек всё равно нажмёт не глядя. Ключ одноразовый, и второй заход
 * по той же ссылке отвечает словами, а не молчанием.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const outcome = await verify(token);

  return (
    <main className="state">
      <div className="state__card">
        <div className="login__brand">
          <Brand eyebrow="кабинет" />
        </div>
        <h1 className="state__title">{outcome.title}</h1>
        <p className="state__text">{outcome.text}</p>
        <Link className="btn btn--gold" href="/login">
          Войти
        </Link>
      </div>
    </main>
  );
}

async function verify(token: string | undefined): Promise<{ title: string; text: string }> {
  if (!token) {
    return {
      title: 'Ссылка неполная',
      text: 'Откройте ссылку из письма целиком — вместе с ключом после «token=».',
    };
  }

  try {
    await getCore().verifyMerchantEmail(token);
    return {
      title: 'Почта подтверждена',
      text:
        'Анкета ушла на рассмотрение. О решении мы напишем на этот адрес; ' +
        'войти в кабинет можно уже сейчас.',
    };
  } catch {
    /*
     * Что именно не так — истёк ключ, его уже использовали или он от
     * другого письма, — здесь не разбирается: ответ один, и делать по
     * нему нужно одно и то же. Разные слова только помогли бы
     * перебирать ключи.
     */
    return {
      title: 'Ссылка не сработала',
      text:
        'Она живёт сутки и срабатывает один раз. Если почта уже подтверждена, просто ' +
        'войдите; если нет — заведите кабинет заново или напишите в поддержку.',
    };
  }
}
