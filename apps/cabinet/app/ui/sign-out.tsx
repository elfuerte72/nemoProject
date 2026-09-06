'use client';

/**
 * Выход с экрана состояния.
 *
 * Нужен там, где кабинета ещё нет: анкета на рассмотрении или
 * отклонена, а шапки с меню сотрудника на этих экранах не бывает —
 * и человек, вошедший не тем аккаунтом, остаётся на них навсегда.
 */
export function SignOut() {
  async function signOut(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <button type="button" className="btn btn--ghost" onClick={() => void signOut()}>
      Выйти
    </button>
  );
}
