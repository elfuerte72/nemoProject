'use client';

/**
 * Выход с экрана состояния.
 *
 * Нужен там, где кабинета ещё нет: анкета на рассмотрении или
 * отклонена, а шапки с меню сотрудника на этих экранах не бывает —
 * и человек, вошедший не тем аккаунтом, остаётся на них навсегда.
 *
 * Куки в кабинете две — мерчанта и амбассадора, — и снимать надо ту,
 * которой вошли: с одной машины работают обе, и общий выход выбрасывал
 * бы заодно соседа. Поэтому путь и адрес после выхода называет тот, кто
 * показал экран.
 */
export function SignOut({
  path = '/api/auth/logout',
  after = '/login',
}: {
  readonly path?: string;
  readonly after?: string;
}) {
  async function signOut(): Promise<void> {
    await fetch(path, { method: 'POST' });
    window.location.href = after;
  }

  return (
    <button type="button" className="btn btn--ghost" onClick={() => void signOut()}>
      Выйти
    </button>
  );
}
