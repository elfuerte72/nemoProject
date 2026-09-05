import { formatAmount } from '@/lib/format';
import { formatByCurrency, type MoneyLine } from '@/lib/money-list';
import { CopyValue } from '@/app/ui/copy';
import { Moment } from '@/app/ui/moment';

/**
 * С кем имеет дело менеджер.
 *
 * Одна и та же панель у разговора, у заявки и у самого клиента: вопрос
 * «кто это» один и тот же, и отвечать на него по-разному в трёх местах
 * значит вести три разных представления о клиенте.
 *
 * Числа стоят здесь, а не только в разделе «Клиенты»: менеджер отвечает
 * в переписке, и «работали ли мы с ним, сколько раз, скольких он привёл»
 * — часть того же вопроса. Уйти за ними на соседний экран посреди
 * разговора нельзя: ответ ждут сейчас.
 *
 * Клиент едет сюда строками: `bigint` и `Date` в клиентский компонент
 * не переезжают, а карточка стоит и на серверных страницах, и внутри
 * клиентских. Перевод — `toClientCardData` в `lib/client-card.ts`.
 */
export interface ClientCardStats {
  readonly completed: number;
  readonly open: number;
  readonly cancelled: number;
  readonly lastRequestAt: string | null;
  readonly turnover: readonly MoneyLine[];
  readonly regular: boolean;
  readonly invitedLine1: number;
  readonly invitedLine2: number;
  readonly referralEarned: string;
}

export interface ClientCardData {
  readonly telegramUserId: string;
  readonly username: string | null;
  readonly createdAt: string;
  readonly referralCode: string;
  readonly referrerId: string | null;
  readonly referrerUsername: string | null;
  readonly marketingConsent: boolean;
  readonly stats: ClientCardStats;
}

/**
 * «5 исполнено · 1 в работе · 2 отменено» — без нулевых частей.
 *
 * Нули в строке съедают её целиком: «0 в работе · 0 отменено» читается
 * дольше, чем то единственное число, за которым сюда смотрят.
 */
function sayRequests(stats: ClientCardStats): string {
  const parts = [`${stats.completed} исполнено`];
  if (stats.open > 0) parts.push(`${stats.open} в работе`);
  if (stats.cancelled > 0) parts.push(`${stats.cancelled} отменено`);
  return parts.join(' · ');
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
  const stats = client?.stats;
  const turnover = stats?.turnover.length ? formatByCurrency(stats.turnover) : undefined;
  /*
   * Заработок на рефералах — только у того, кому уже начислили. Строка
   * «0 баллов» у клиента, который никого не звал, отвечает на вопрос,
   * которого никто не задавал.
   */
  const earned =
    stats && Number(stats.referralEarned) > 0 ? formatAmount(stats.referralEarned) : undefined;

  return (
    <aside className="card who">
      <h2 className="card__title">
        Клиент
        {stats?.regular ? <span className="tag tag--gold"> постоянный</span> : undefined}
      </h2>

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

      {client && stats ? (
        <>
          <div className="field">
            <span className="label">В сервисе с</span>
            <span>
              <Moment at={client.createdAt} mode="day" />
            </span>
          </div>

          <div className="field">
            <span className="label">Заявки</span>
            {stats.completed + stats.open + stats.cancelled === 0 ? (
              <span className="muted">Ни одной пока не подавал</span>
            ) : (
              <span>{sayRequests(stats)}</span>
            )}
          </div>

          {turnover ? (
            <div className="field">
              <span className="label">Оборот</span>
              <span>{turnover}</span>
            </div>
          ) : undefined}

          {stats.lastRequestAt ? (
            <div className="field">
              <span className="label">Последняя заявка</span>
              <span>
                <Moment at={stats.lastRequestAt} mode="day" />
              </span>
            </div>
          ) : undefined}

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
            <span className="label">Привёл клиентов</span>
            {stats.invitedLine1 + stats.invitedLine2 === 0 ? (
              <span className="muted">Никого</span>
            ) : (
              <span>
                {stats.invitedLine1}
                {stats.invitedLine2 > 0 ? ` · по второй линии ещё ${stats.invitedLine2}` : ''}
              </span>
            )}
          </div>

          {earned ? (
            <div className="field">
              <span className="label">Заработал на рефералах</span>
              <span>{earned} баллов</span>
            </div>
          ) : undefined}

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
