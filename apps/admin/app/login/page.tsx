import { devLoginAllowedHere } from '@/lib/auth/dev-login';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

/**
 * Показывать ли вход для разработки, решает сервер, а не браузер.
 *
 * Признак приходит готовым свойством: переменная, вынесенная в
 * `NEXT_PUBLIC_`, уехала бы в клиентский пакет и в проде, а решение о
 * том, кого пускать, читалось бы из кода страницы.
 */
export default function LoginPage() {
  return <LoginForm devLogin={devLoginAllowedHere()} />;
}
