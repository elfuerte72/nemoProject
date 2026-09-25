import { formatAmount } from '@nemo/ui';
import { ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS } from '@/lib/attempts';
import { RATE_LIMITS } from '@/lib/v1/rate-limit';

/**
 * «Ограничения»: пределы вызовов и сколько раз в них упёрлись.
 *
 * Числа — из тех же констант, которыми считает адаптер, а не
 * переписанные сюда: предел поменяют в коде, и карточка поменяется
 * вместе с ним. «Упёрлись за сутки» — из журнала вызовов.
 */
export function Limits({ rateLimitedToday }: { readonly rateLimitedToday: number }) {
  const lockMinutes = Math.round(ATTEMPT_WINDOW_MS / 60_000);
  return (
    <section className="card">
      <h2 className="card__title">Ограничения</h2>
      <dl className="kv">
        <Row name="Вызовов в минуту" hint="на ключ" value={count(RATE_LIMITS.perMinute)} />
        <Row name="Вызовов в час" hint="на ключ" value={count(RATE_LIMITS.perHour)} />
        <Row
          name="Упёрлись в предел за сутки"
          hint="ответ 429 rate_limited"
          value={count(rateLimitedToday)}
        />
        <Row
          name="Неверных ключей с одного адреса"
          hint={`дальше адрес ждёт ${lockMinutes} минут`}
          value={count(ATTEMPT_LIMIT)}
        />
      </dl>
      <p className="card__note">
        Остаток приходит в каждом ответе, где ключ действует и адрес разрешён:
        x-ratelimit-remaining-minute и x-ratelimit-remaining-hour; когда откроется окно,
        говорит x-ratelimit-reset.
      </p>
    </section>
  );
}

/** Целое с разрядами — «1 000», как остальные числа кабинета. */
function count(value: number): string {
  return formatAmount(String(value));
}

function Row({ name, hint, value }: { readonly name: string; readonly hint: string; readonly value: string }) {
  return (
    <div className="kv__row">
      <dt className="kv__name">
        {name}
        <span className="kv__hint">{hint}</span>
      </dt>
      <dd className="kv__value">{value}</dd>
    </div>
  );
}
