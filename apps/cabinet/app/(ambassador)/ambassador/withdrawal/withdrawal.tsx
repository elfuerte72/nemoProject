'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { WithdrawalRequestStatus } from '@nemo/types';
import {
  currencyName,
  describeRequisites,
  isServiceCurrencyRequisiteKind,
  REQUISITE_KIND_LABELS,
  requisiteCurrencyCodes,
  requisiteKindsFor,
  sortCurrencies,
} from '@nemo/types';
import { EmptyState, Moment } from '@nemo/ui';
import { formatAmount } from '@nemo/ui/format';
import { EMPTY_DRAFT, RecipientFields, type RecipientDraft } from '@/app/ui/recipient-fields';
import type { RecipientRow } from '@/lib/recipient-rows';
import { send } from '@/app/ui/send';

/**
 * Вывод: заявка на свой реквизит и история выплат.
 *
 * Реквизит заводится тут же теми же полями, что у получателей мерчанта
 * (`recipient-fields.tsx`), — они не знают, куда уйдёт набранное, и
 * это ровно тот случай, ради которого их вынесли. Показываются только
 * те валюты и способы, которыми сервис платит: рубли и USDT на
 * телефон, карту и кошелёк — правило ядра
 * (`serviceCurrencyRequisiteKinds`), и форма повторяет его, чтобы не
 * предлагать того, что операция отвергнет.
 *
 * Подача необратима — деньги уходят живому человеку, — и потому
 * спрашивает подтверждение. Пока идёт запрос, подтверждение не
 * закрывается ничем: закрытое на полпути, оно оставило бы без ответа о
 * том, чем всё кончилось.
 */

const STATUS_LABELS: Record<WithdrawalRequestStatus, string> = {
  new: 'Новая — ждёт менеджера',
  approved: 'Одобрена — готовим выплату',
  paid: 'Выплачена',
  rejected: 'Отклонена',
};

export interface WithdrawalRow {
  readonly id: string;
  readonly amount: string;
  readonly status: WithdrawalRequestStatus;
  readonly destinationHint: string | null;
  readonly rejectReason: string | null;
  readonly createdAt: string;
  readonly paidAt: string | null;
}

/** Валюты выплаты: те, в которых сервис держит свои деньги. */
function payoutCurrencies(): readonly string[] {
  return sortCurrencies(
    requisiteCurrencyCodes().filter((code) =>
      requisiteKindsFor(code).some(isServiceCurrencyRequisiteKind),
    ),
  );
}

export function Withdrawal({
  balance,
  held,
  minAmount,
  requisites,
  requests,
  networks,
}: {
  /** Доступно сейчас: остаток за вычетом уже поданных заявок. */
  readonly balance: string;
  /** Сколько держат поданные заявки — о них сказано отдельной строкой. */
  readonly held: string;
  readonly minAmount: string;
  readonly requisites: readonly RecipientRow[];
  readonly requests: readonly WithdrawalRow[];
  readonly networks: readonly string[];
}) {
  const router = useRouter();
  const payable = requisites.filter((one) => isServiceCurrencyRequisiteKind(one.kind));

  const [amount, setAmount] = useState('');
  /*
   * Выбранная запись, а не «первая на момент первого рендера»: реквизит
   * заводят тут же, и запомненный однажды пустой выбор оставлял бы
   * кнопку погашенной после того, как запись появилась.
   */
  const [picked, setPicked] = useState<string>();
  const chosen = picked && payable.some((one) => one.id === picked) ? picked : payable[0]?.id ?? '';
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();

  const currencies = payoutCurrencies();
  const [currency, setCurrency] = useState(currencies[0] ?? '');
  const [draft, setDraft] = useState<RecipientDraft>(EMPTY_DRAFT);
  const [formKey, setFormKey] = useState(0);
  const [addingBusy, setAddingBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setComplaint(undefined);
    const result = await send('/api/ambassador/withdrawals', {
      amount: amount.trim().replace(',', '.'),
      requisitesId: chosen,
    });
    setBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    setConfirming(false);
    setAmount('');
    router.refresh();
  }

  async function addRequisites() {
    setAddingBusy(true);
    setComplaint(undefined);
    const result = await send('/api/ambassador/requisites', draft.input);
    setAddingBusy(false);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    setDraft(EMPTY_DRAFT);
    setFormKey((was) => was + 1);
    router.refresh();
  }

  return (
    <>
      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Остаток</h2>
            <p className="card__note">
              Доступно {formatAmount(balance)}; минимум на одну заявку — {formatAmount(minAmount)}
              {held !== '0' ? ` · ${formatAmount(held)} держат поданные заявки` : ''}
            </p>
          </div>
        </div>

        {complaint ? <p className="error">{complaint}</p> : undefined}

        {payable.length === 0 ? (
          <p className="card__note">
            Заявку не на что подать: сначала заведите реквизит ниже — телефон, карту или
            криптокошелёк.
          </p>
        ) : (
          <>
            <div className="form-row">
              <label className="field field--narrow">
                <span className="label">Сумма</span>
                <input
                  className="input"
                  value={amount}
                  inputMode="decimal"
                  placeholder={formatAmount(minAmount)}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <label className="field field--wide">
                <span className="label">Куда</span>
                <select
                  className="input"
                  value={chosen}
                  onChange={(event) => setPicked(event.target.value)}
                >
                  {payable.map((one) => (
                    <option key={one.id} value={one.id}>
                      {describeRequisites(one)} · {REQUISITE_KIND_LABELS[one.kind]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {confirming ? (
              <div className="confirm">
                <p className="card__note">
                  {formatAmount(amount || '0')} уйдут на «
                  {describeRequisites(payable.find((one) => one.id === chosen) ?? payable[0]!)}».
                  Менеджер увидит заявку в очереди выплат; отменить её сами вы уже не сможете.
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn--gold"
                    disabled={busy}
                    aria-busy={busy}
                    onClick={() => void submit()}
                  >
                    {busy ? 'Подаём…' : 'Подать заявку'}
                  </button>
                  {/* Пока идёт запрос, отступить нельзя: закрытое на
                      полпути подтверждение оставило бы без ответа. */}
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    Не сейчас
                  </button>
                </div>
              </div>
            ) : (
              <div className="actions">
                <button
                  type="button"
                  className="btn btn--gold"
                  disabled={!amount.trim() || !chosen}
                  onClick={() => setConfirming(true)}
                >
                  Вывести
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">Выплаты</h2>
        {requests.length ? (
          <div className="scroll-x">
            <table className="datatable">
              <thead>
                <tr>
                  <th>Подана</th>
                  <th className="num">Сумма</th>
                  <th>Куда</th>
                  <th>Состояние</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Moment at={row.createdAt} mode="day" />
                    </td>
                    <td className="num">{formatAmount(row.amount)}</td>
                    <td>{row.destinationHint ?? '—'}</td>
                    <td>
                      <div className="cell">
                        <span>{STATUS_LABELS[row.status]}</span>
                        {row.rejectReason ? (
                          <span className="cell__note">{row.rejectReason}</span>
                        ) : row.paidAt ? (
                          <span className="cell__note">
                            <Moment at={row.paidAt} mode="day" />
                          </span>
                        ) : undefined}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="withdrawal"
            title="Выплат ещё не было"
            text="Первая появится здесь сразу после подачи заявки."
          />
        )}
      </section>

      <section className="card">
        <h2 className="card__title">Новый реквизит</h2>
        <p className="card__note">
          Сервис платит в рублях и USDT — на телефон, карту или криптокошелёк
        </p>

        <div className="field">
          <span className="label">Валюта выплаты</span>
          <div className="chips" role="group" aria-label="Валюта выплаты">
            {currencies.map((code) => (
              <button
                key={code}
                type="button"
                className={currency === code ? 'chip chip--on' : 'chip'}
                aria-pressed={currency === code}
                title={currencyName(code)}
                onClick={() => setCurrency(code)}
              >
                {code}
              </button>
            ))}
          </div>
        </div>

        <RecipientFields
          key={`${currency}:${formKey}`}
          currency={currency}
          networks={networks}
          disabled={addingBusy}
          onChange={setDraft}
        />

        <div className="row__actions">
          <button
            type="button"
            className="btn btn--soft"
            disabled={addingBusy || !draft.input}
            aria-busy={addingBusy}
            onClick={() => void addRequisites()}
          >
            {addingBusy ? 'Сохраняем…' : 'Сохранить реквизит'}
          </button>
          <span className="muted">
            Номер сохранится зашифрованным: дальше вы увидите только его края.
          </span>
        </div>
      </section>
    </>
  );
}
