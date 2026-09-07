/**
 * Приветствие по часу. Границы — те, по которым говорят люди: до пяти
 * ещё ночь, до полудня утро, до шести день, дальше вечер.
 */
export function salute(hour: number): string {
  if (hour < 5) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

/** Дата словами с большой буквы: «Среда, 2 сентября». */
export function dayWords(date: Date): string {
  const words = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  return words.charAt(0).toUpperCase() + words.slice(1);
}
