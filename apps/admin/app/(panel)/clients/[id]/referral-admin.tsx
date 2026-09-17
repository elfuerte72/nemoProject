'use client';

import { useState } from 'react';
import { HowTo } from '@nemo/ui';
import { referralLineTitle } from '@nemo/types';
import type { ClientReferralData } from '@/app/ui/client-card';
import { decimalFromInput } from '@/lib/decimal-input';
import { bpsToPercent } from '@/lib/percent';
import { individualDraftsToRates } from '@/lib/referral-program-forms';
import { CLIENT_REFERRAL_HOW_TO } from '@/lib/referral-texts';
import { useAction } from '@/lib/use-action';

/**
 * Клиент в реферальной программе — администратору: личные ставки и
 * правка баллов. Менеджер этого блока не видит, но и без блока операции
 * ему откажут: скрытая кнопка — видимость разграничения, а не оно само.
 *
 * Правка баллов спрашивает подтверждение раскрытием строки, как отказ
 * мерчанту: кнопка не гаснет, комментарий обязателен.
 */
export function ReferralAdmin({
  clientId,
  referral,
}: {
  readonly clientId: string;
  readonly referral: ClientReferralData;
}) {
  const { busy, error, act: post } = useAction(`/api/clients/${clientId}/referral`);
  const [drafts, setDrafts] = useState<string[]>(() =>
    referral.lines.map((line) => {
      const own = referral.individual.find((one) => one.line === line.line);
      return own ? bpsToPercent(own.rateBps) : '';
    }),
  );
  const [adjusting, setAdjusting] = useState(false);
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const rates = individualDraftsToRates(drafts);

  const act = async (body: Record<string, unknown>) => {
    if (await post(body)) {
      setAdjusting(false);
      setAmount('');
      setComment('');
    }
  };

  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">Реферальная программа</h2>
        <span className="section__rule" />
      </div>
      <HowTo title="Как устроено" sub="Личные ставки и правка баллов" items={CLIENT_REFERRAL_HOW_TO} />

      {error ? <p className="error">{error}</p> : undefined}

      <div className="form-row">
        {drafts.map((draft, index) => {
          const line = index + 1;
          return (
            <label key={line} className="field">
              <span className="label">{referralLineTitle(line)} линия, %</span>
              <input
                className="input"
                value={draft}
                inputMode="decimal"
                placeholder="наследует"
                onChange={(event) =>
                  setDrafts((current) =>
                    current.map((one, at) => (at === index ? event.target.value : one)),
                  )
                }
              />
            </label>
          );
        })}
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn btn--gold"
          disabled={busy || rates === undefined || rates === null}
          onClick={() => act({ action: 'rates', rates })}
        >
          Сохранить личные ставки
        </button>
        {referral.individual.length > 0 ? (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={async () => {
              await act({ action: 'rates', rates: null });
              setDrafts((current) => current.map(() => ''));
            }}
          >
            Снять личные ставки
          </button>
        ) : undefined}
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy}
          onClick={() => setAdjusting((open) => !open)}
        >
          Правка баллов
        </button>
      </div>

      {adjusting ? (
        <div className="confirm">
          <div className="form-row">
            <label className="field">
              <span className="label">Сумма со знаком, баллов</span>
              <input
                className="input"
                value={amount}
                inputMode="decimal"
                placeholder="300 или -100"
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">За что</span>
              <input
                className="input"
                value={comment}
                placeholder="Клиент прочтёт это в истории"
                onChange={(event) => setComment(event.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy || !amount.trim() || !comment.trim()}
            onClick={() => act({ action: 'adjust', amount: decimalFromInput(amount), comment })}
          >
            Провести правку
          </button>
        </div>
      ) : undefined}
    </section>
  );
}
