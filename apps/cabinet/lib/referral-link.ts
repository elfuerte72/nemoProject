/**
 * Ссылка, по которой амбассадор зовёт людей.
 *
 * Собирается здесь, а не в ядре, — по той же причине, по какой её
 * собирает у себя Mini App (`apps/miniapp/lib/referral.ts`): адрес бота
 * это свойство развёртывания, и операция, знающая его, перестала бы
 * работать при смене имени бота, не сломавшись заметно.
 *
 * Имя бота у кабинета приходит обычной переменной, а не `NEXT_PUBLIC_*`:
 * страницы здесь серверные, и вшивать имя на сборке значило бы менять
 * его пересборкой.
 */

export function referralLink(code: string): string | null {
  const bot = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '');
  return bot ? `https://t.me/${bot}?startapp=${code}` : null;
}

/**
 * «Поделиться» — тот же экран пересылки, которым Telegram делится
 * чем угодно. Текст короткий: длинный за человека всё равно перепишут.
 */
export function shareLink(link: string): string {
  const text = 'Обмен валют в Telegram: рубли, USDT, наличные за границей';
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}
