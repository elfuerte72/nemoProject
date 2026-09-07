/**
 * «Поддержка» — ссылка на личный Telegram того, кто отвечает мерчантам.
 *
 * Ник живёт настройкой в панели, а не в коде: передать поддержку
 * другому человеку надо уметь без выкатки. Ника нет — нет и ссылки:
 * выдуманная вела бы в пустой чат, а это хуже её отсутствия.
 */
export function SupportLink({
  username,
  className = 'btn btn--soft',
}: {
  readonly username: string | null;
  readonly className?: string;
}) {
  if (!username) {
    return (
      <p className="muted">
        Поддержка сейчас не назначена. Напишите тому, с кем договаривались о работе.
      </p>
    );
  }

  return (
    <a
      className={className}
      href={`https://t.me/${username.replace(/^@/, '')}`}
      target="_blank"
      rel="noreferrer"
    >
      Написать в поддержку
    </a>
  );
}
