/**
 * Каркас админ-панели.
 *
 * Вход: Telegram Login → допуск по списку сотрудников → одноразовый код.
 * Проверка первого фактора готова (lib/auth/telegram-login.ts), второй
 * фактор и сами экраны заявок — следующий шаг.
 */
export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1 style={{ fontSize: '1.25rem' }}>Админ-панель</h1>
      <p style={{ opacity: 0.75 }}>Вход и экраны заявок в работе.</p>
    </main>
  );
}
