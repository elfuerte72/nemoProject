import { CurrencyFlag } from '@nemo/flags';
import { Money } from '@nemo/types';
import { formatMoney } from '@nemo/ui/format';
import { compareByCurrency, type MoneyLine } from '@nemo/ui/money-list';

/**
 * Деньги по валютам столбиком и со значком — на обзоре и в плитках
 * аналитики. Так же суммы стоят на «Счетах», «Возвратах» и «Курсах»:
 * строкой через точку «238 000 RUB · 6 200 USDT» крупным кеглем
 * переносилась посреди суммы, и глаз искал, где кончается одна валюта и
 * начинается другая.
 *
 * С прошлым периодом каждая валюта сравнивается только с собой — рубли
 * с рублями (docs/adr/0013), — и «было» стоит в той же строке, что и
 * «стало»: под столбиком оно читалось бы как ещё одна валюта. Валюта,
 * в которой в прошлом периоде деньги были, а в этом нет, остаётся
 * строкой с прочерком: пропавшая строка спрятала бы падение до нуля, а
 * отчёт его показывает.
 *
 * Код валюты остаётся в тексте рядом со значком: значок экранному
 * диктору не виден, а сумма без валюты — не сумма.
 */
export function MoneyFlags({
  lines,
  before,
  empty = '—',
  size = 18,
}: {
  readonly lines: readonly MoneyLine[];
  /** Прошлый период — «было» у каждой валюты. Без него сравнения нет. */
  readonly before?: readonly MoneyLine[] | undefined;
  /** Что стоит вместо сумм, когда их нет ни сейчас, ни прежде: прочерк, а не «0 RUB». */
  readonly empty?: string;
  readonly size?: number;
}) {
  const compared = before ? compareByCurrency(lines, before) : [];
  const gone = (before ?? []).filter(
    (was) => !Money.isZero(was.amount) && !lines.some((line) => line.code === was.code),
  );
  if (lines.length === 0 && gone.length === 0) {
    return (
      <div className="money-flags money-flags--empty">
        <span className="money-flags__amount">{empty}</span>
      </div>
    );
  }
  return (
    <ul className="money-flags">
      {lines.map((line) => {
        const was = compared.find((one) => one.code === line.code);
        return (
          <li key={line.code} className="money-flags__row">
            <CurrencyFlag code={line.code} size={size} />
            <span className="money-flags__amount">{formatMoney(line.amount, line.code)}</span>
            {was ? (
              <span className={`money-flags__was delta delta--${was.delta}`}>
                было {formatMoney(was.before, line.code)}
              </span>
            ) : undefined}
          </li>
        );
      })}
      {gone.map((was) => (
        <li key={was.code} className="money-flags__row">
          <CurrencyFlag code={was.code} size={size} />
          <span className="money-flags__amount">— {was.code}</span>
          <span className="money-flags__was delta delta--down">
            было {formatMoney(was.amount, was.code)}
          </span>
        </li>
      ))}
    </ul>
  );
}
