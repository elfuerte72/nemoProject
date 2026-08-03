import { CopyValue } from '@/app/ui/copy';
import { Moment } from '@/app/ui/moment';

/**
 * С кем имеет дело менеджер.
 *
 * Одна и та же панель у разговора и у заявки: вопрос «кто это» один и
 * тот же, и отвечать на него по-разному в двух местах значит вести два
 * разных представления о клиенте.
 *
 * Клиент едет сюда строками: `bigint` и `Date` в клиентский компонент
 * не переезжают, а карточка стоит и на серверных страницах, и внутри
 * клиентских.
 */
export interface ClientCardData {
  readonly telegramUserId: string;
  readonly username: string | null;
  readonly createdAt: string;
  readonly referralCode: string;
  readonly referrerId: string | null;
  readonly referrerUsername: string | null;
  readonly marketingConsent: boolean;
}

export function ClientCard({
  client,
  clientId,
  /** Ссылка на разговор. Пусто там, где менеджер уже в разговоре. */
  conversationHref,
}: {
  readonly client: ClientCardData | null;
  /** Номер клиента: он известен всегда, даже когда карточки нет. */
  readonly clientId: string;
  readonly conversationHref?: string | undefined;
}) {
  return (
    <aside className="card who">
      <h2 className="card__title">Клиент</h2>

      <div className="field">
        <span className="label">Telegram</span>
        {client?.username ? (
          /*
            Ссылка ведёт по нику, а не по номеру: аккаунт по числовому
            идентификатору Telegram не открывает, и кнопка «перейти»,
            которая никуда не ведёт, хуже её отсутствия. Без ника
            окликнуть человека можно только тем же ботом.
          */
          <a
            className="who__link"
            href={`https://t.me/${client.username}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            @{client.username} ↗
          </a>
        ) : (
          <span className="muted">Ника нет — пишет только через бота</span>
        )}
      </div>

      <div className="field">
        <span className="label">Идентификатор</span>
        <CopyValue value={clientId} />
      </div>

      {client ? (
        <>
          <div className="field">
            <span className="label">В сервисе с</span>
            <span>
              <Moment at={client.createdAt} mode="day" />
            </span>
          </div>

          <div className="field">
            <span className="label">Пригласил</span>
            <span>
              {client.referrerId
                ? client.referrerUsername
                  ? `@${client.referrerUsername}`
                  : client.referrerId
                : 'Пришёл сам'}
            </span>
          </div>

          <div className="field">
            <span className="label">Рассылка</span>
            <span>{client.marketingConsent ? 'Согласен' : 'Не согласен'}</span>
          </div>

          <div className="field">
            <span className="label">Реферальный код</span>
            <CopyValue value={client.referralCode} />
          </div>
        </>
      ) : (
        <p className="card__note">
          Клиент писал боту, но приложение ещё не открывал — профиля у него нет.
        </p>
      )}

      {conversationHref ? (
        <a className="btn btn--soft" href={conversationHref}>
          Написать клиенту
        </a>
      ) : undefined}
    </aside>
  );
}
