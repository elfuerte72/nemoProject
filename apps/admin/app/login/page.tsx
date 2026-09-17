import { devLoginAllowedHere } from '@/lib/auth/dev-login';
import { RETURN_TO_PARAM, safeReturnPath } from '@/lib/auth/return-to';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

/**
 * Показывать ли вход для разработки, решает сервер, а не браузер.
 *
 * Признак приходит готовым свойством: переменная, вынесенная в
 * `NEXT_PUBLIC_`, уехала бы в клиентский пакет и в проде, а решение о
 * том, кого пускать, читалось бы из кода страницы.
 *
 * Адрес возврата разбирается здесь же, на сервере: в `?next=` написать
 * можно что угодно, и форма получает уже проверенный путь своей панели
 * (`lib/auth/return-to.ts`), а не строку из адреса.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = (await searchParams)[RETURN_TO_PARAM];
  const returnTo = safeReturnPath(Array.isArray(next) ? next[0] : next) ?? '/';
  return <LoginForm devLogin={devLoginAllowedHere()} returnTo={returnTo} />;
}
