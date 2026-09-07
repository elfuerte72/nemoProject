'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  currencyName,
  describeRequisites,
  REQUISITE_KIND_LABELS,
  requisiteCurrencyCodes,
  sortCurrencies,
} from '@nemo/types';
import { EmptyState, Moment } from '@nemo/ui';
import { recipientCurrency, type RecipientRow } from '@/lib/recipient-rows';
import { EMPTY_DRAFT, RecipientFields, type RecipientDraft } from '@/app/ui/recipient-fields';
import { send } from '@/app/ui/send';

/**
 * Получатели: список сохранённых записей и заведение новой.
 *
 * Поправить запись нельзя — номер хранится зашифрованным и наружу не
 * отдаётся; «изменить» значит завести новую и удалить старую. Удаление
 * необратимо и спрашивает подтверждение раскрытием строки, как везде в
 * кабинете.
 */
export function Recipients({
  recipients,
  networks,
  canAdd,
}: {
  readonly recipients: readonly RecipientRow[];
  readonly networks: readonly string[];
  /** Ложь у отключённого: новые записи ему ни к чему, удаление работает. */
  readonly canAdd: boolean;
}) {
  const router = useRouter();
  const currencies = sortCurrencies(requisiteCurrencyCodes());
  const [currency, setCurrency] = useState(currencies[0] ?? '');
  const [draft, setDraft] = useState<RecipientDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string>();
  const [complaint, setComplaint] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  /** Ключ формы: после сохранения поля начинаются заново. */
  const [formKey, setFormKey] = useState(0);

  async function act(key: string, path: string, body: unknown, after: () => void) {
    setBusy(key);
    setComplaint(undefined);
    const result = await send(path, body);
    setBusy(undefined);
    if (!result.ok) {
      setComplaint(result.complaint);
      return;
    }
    after();
    router.refresh();
  }

  return (
    <>
      <section className="card">
        <h2 className="card__title">Сохранённые</h2>

        {complaint ? <p className="error">{complaint}</p> : undefined}

        {recipients.length === 0 ? (
          <EmptyState
            icon="card"
            title="Записей пока нет"
            text="Заведите свои реквизиты ниже — и подавайте заявки на них в один выбор."
          />
        ) : (
          groupByCurrency(recipients).map(({ code, rows }) => (
            <div key={code} className="recipient__group">
              {/*
                По валюте, которая приходит на запись: за батами и за
                рублями идут в разные записи, и список читается по
                валюте, а не по дате заведения.
              */}
              <h3 className="recipient__currency">
                {code}
                <span className="muted"> · {currencyName(code)}</span>
              </h3>
              <ul className="rows">
                {rows.map((one) => (
              <li key={one.id} className="row row--stack">
                <div className="row__main">
                  <span className={one.isAvailable ? 'row__title' : 'row__title muted'}>
                    {describeRequisites(one)}
                  </span>
                  <span className="row__meta">
                    {REQUISITE_KIND_LABELS[one.kind]}
                    {one.holderName ? ` · ${one.holderName}` : ''}
                    {one.isAvailable ? '' : ' · сеть временно недоступна'}
                  </span>
                </div>
                <div className="row__side">
                  <span className="muted">
                    заведена <Moment at={one.createdAt} />
                  </span>
                </div>
                <div className="row__actions">
                  {removing === one.id ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--danger btn--tiny"
                        aria-busy={busy === `remove:${one.id}`}
                        onClick={() =>
                          void act(
                            `remove:${one.id}`,
                            `/api/requisites/${one.id}/remove`,
                            {},
                            () => setRemoving(undefined),
                          )
                        }
                      >
                        Да, удалить
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--tiny"
                        onClick={() => setRemoving(undefined)}
                      >
                        Оставить
                      </button>
                      <span className="muted">
                        Уже поданные заявки останутся как есть: деньги по ним придут туда же.
                      </span>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--ghost btn--tiny"
                      onClick={() => setRemoving(one.id)}
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2 className="card__title">Новая запись</h2>
        {canAdd ? (
          <div className="recipient">
            <div className="field">
              <span className="label">Валюта получения</span>
              <div className="chips" role="group" aria-label="Валюта получения">
                {currencies.map((code) => (
                  <button
                    key={code}
                    type="button"
                    className={currency === code ? 'chip chip--on' : 'chip'}
                    aria-pressed={currency === code}
                    onClick={() => setCurrency(code)}
                    title={currencyName(code)}
                  >
                    {code}
                  </button>
                ))}
              </div>
              <span className="cell__note">
                Только валюты, которые сервис принимает реквизитами: под каждую — свои способы.
              </span>
            </div>

            <RecipientFields
              key={`${currency}:${formKey}`}
              currency={currency}
              networks={networks}
              disabled={busy === 'add'}
              onChange={setDraft}
            />

            <div className="row__actions">
              <button
                type="button"
                className="btn btn--gold"
                disabled={busy === 'add' || !draft.input}
                aria-busy={busy === 'add'}
                onClick={() =>
                  void act('add', '/api/requisites', draft.input, () => {
                    setDraft(EMPTY_DRAFT);
                    setFormKey((was) => was + 1);
                  })
                }
              >
                {busy === 'add' ? 'Сохраняем…' : 'Сохранить получателя'}
              </button>
              <span className="muted">
                Номер сохранится зашифрованным: дальше вы увидите только его края.
              </span>
            </div>
          </div>
        ) : (
          <p className="card__note">
            Доступ отключён: новые записи не заводятся, удаление работает.
          </p>
        )}
      </section>
    </>
  );
}

/**
 * Записи по валюте, которая на них приходит, — в порядке списка выбора
 * валют; внутри группы как пришли, новые сверху.
 */
function groupByCurrency(
  recipients: readonly RecipientRow[],
): readonly { readonly code: string; readonly rows: readonly RecipientRow[] }[] {
  const codes = sortCurrencies([
    ...new Set(recipients.map((one) => recipientCurrency(one.kind) ?? '—')),
  ]);
  return codes.map((code) => ({
    code,
    rows: recipients.filter((one) => (recipientCurrency(one.kind) ?? '—') === code),
  }));
}
