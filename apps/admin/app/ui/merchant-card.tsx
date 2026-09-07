import Link from 'next/link';
import type { MerchantStatus } from '@nemo/types';
import { CopyValue, Moment } from '@nemo/ui';

/**
 * С кем имеет дело менеджер, когда заявку подал бизнес.
 *
 * На месте карточки клиента и по тем же правилам: тот же вопрос «кто
 * это», тот же угол экрана. Отличий два, и оба существенные. Переписки
 * у мерчанта нет — вопросы он задаёт в поддержку по ссылке из кабинета,
 * — поэтому вместо кнопки «открыть разговор» стоят телефон и почта из
 * анкеты: писать ему менеджер будет ими. И числа здесь другие: заявки
 * есть, а баллов, рефералки и согласия на рассылку не бывает.
 *
 * Мерчант едет сюда строками: `Date` в клиентский компонент не
 * переезжает, а карточка стоит и на серверных страницах, и внутри
 * клиентских.
 */
export interface MerchantCardData {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly contactName: string;
  readonly site: string | null;
  readonly status: MerchantStatus;
  readonly createdAt: string;
}

export const MERCHANT_STATUS_LABELS: Readonly<Record<MerchantStatus, string>> = {
  pending: 'На рассмотрении',
  active: 'Активен',
  rejected: 'Отклонён',
  disabled: 'Отключён',
};

/**
 * Золотом — то, что ждёт человека или мешает работе: анкета на
 * рассмотрении и закрытый доступ. Активный мерчант — обычное состояние,
 * и красить его не за чем.
 */
export function merchantPillClass(status: MerchantStatus): string {
  return status === 'active' ? 'pill' : 'pill pill--gold';
}

export function MerchantCard({
  merchant,
  /**
   * Ведёт ли название на карточку. Ложь там, где менеджер уже в ней:
   * ссылка на страницу, на которой стоишь, обещает переход и не делает
   * его.
   */
  linked = true,
  /** Ссылка на заявки этого мерчанта. Пусто там, где менеджер уже в них. */
  requestsHref,
}: {
  readonly merchant: MerchantCardData;
  readonly linked?: boolean;
  readonly requestsHref?: string | undefined;
}) {
  return (
    <aside className="card who">
      <h2 className="card__title">Мерчант</h2>

      <div className="field">
        <span className="label">Название</span>
        <span>
          {linked ? (
            <Link className="who__link" href={`/merchants/${merchant.id}`}>
              {merchant.name} ↗
            </Link>
          ) : (
            merchant.name
          )}
        </span>
      </div>

      <div className="field">
        <span className="label">Состояние</span>
        {/* Пилюля в обёртке: в колонке поля она растянулась бы на всю
            ширину и перестала читаться отметкой. */}
        <span>
          <span className={merchantPillClass(merchant.status)}>
            {MERCHANT_STATUS_LABELS[merchant.status]}
          </span>
        </span>
      </div>

      {/*
        Почта и телефон — копированием: переписки в системе нет, и
        связаться менеджер может только ими. Набирать их с экрана руками
        значит однажды ошибиться цифрой.
      */}
      <div className="field">
        <span className="label">Почта</span>
        <CopyValue value={merchant.email} />
      </div>

      <div className="field">
        <span className="label">Телефон</span>
        <CopyValue value={merchant.phone} />
      </div>

      <div className="field">
        <span className="label">Контактное лицо</span>
        <span>{merchant.contactName}</span>
      </div>

      {merchant.site ? (
        <div className="field">
          <span className="label">Сайт</span>
          <a
            className="who__link"
            href={merchant.site}
            target="_blank"
            rel="noreferrer noopener"
          >
            {merchant.site} ↗
          </a>
        </div>
      ) : undefined}

      <div className="field">
        <span className="label">В сервисе с</span>
        <span>
          <Moment at={merchant.createdAt} mode="day" />
        </span>
      </div>

      {requestsHref ? (
        <Link className="btn btn--ghost" href={requestsHref}>
          Все заявки мерчанта
        </Link>
      ) : undefined}
    </aside>
  );
}
