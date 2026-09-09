'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BankChips } from '@nemo/ui';
import {
  payoutMethodOf,
  PROMPTPAY_ID_LABELS,
  qrReadingOf,
  REQUISITE_COMPLAINTS,
  REQUISITE_KIND_LABELS,
  requisiteDraftComplaints,
  requisiteHolderRequired,
  requisiteInputOf,
  requisiteKindsFor,
  type PayoutMethod,
  type QrReading,
  type RequisiteField,
  type RequisiteInput,
  type RequisiteKind,
} from '@nemo/types';

/**
 * Поля получателя: способ получения и ровно его поля.
 *
 * Те же правила, что у формы Mini App, — и буквально те же: что не так с
 * набранным, что отправлять и что распозналось из QR, решают
 * `requisiteDraftComplaints`, `requisiteInputOf` и `qrReadingOf` из
 * `@nemo/types`. Все поля способа обязательны — записи, по которой
 * нельзя отправить деньги, не существует; QR читается здесь, в
 * браузере, и на сервер уходит только строка (docs/adr/0012).
 *
 * Поля, а не форма: кнопку и судьбу набранного решает тот, кто их
 * показал. В разделе «Получатели» набранное сохраняется в список, в
 * форме новой заявки уходит вместе с заявкой — и сами поля об этом не
 * знают. Наружу отдаётся черновик: что отправить ядру, каким способом
 * уйдут деньги и чем набранное не похоже на правду.
 */

export interface RecipientDraft {
  /** Что отправить ядру — или пусто, пока заполнено не всё. */
  readonly input: RequisiteInput | undefined;
  /** Куда уйдут деньги — банк или кошелёк: от этого зависит ставка. */
  readonly payoutMethod: PayoutMethod | undefined;
  /** Чем набранное не похоже на правду — теми же словами, что откажет ядро. */
  readonly complaint: string | undefined;
}

export const EMPTY_DRAFT: RecipientDraft = {
  input: undefined,
  payoutMethod: undefined,
  complaint: undefined,
};

/** Что распозналось из картинки — и сама строка, которая уйдёт на сервер. */
type QrRead = Extract<QrReading, { ok: true }> & { readonly payload: string };

/**
 * Номер карты группами по четыре — так он напечатан на пластике, с
 * которым его и сверяют. Лишние цифры отбрасываются на девятнадцатой.
 */
function groupCardDigits(value: string): string {
  return value
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function RecipientFields({
  currency,
  networks,
  disabled = false,
  onChange,
}: {
  /** Валюта получения: под неё показываются только её способы. */
  readonly currency: string;
  readonly networks: readonly string[];
  readonly disabled?: boolean;
  readonly onChange: (draft: RecipientDraft) => void;
}) {
  const kinds = useMemo(() => requisiteKindsFor(currency), [currency]);
  const [kind, setKind] = useState<RequisiteKind | undefined>(kinds[0]);
  const [bankName, setBankName] = useState('');
  const [phone, setPhone] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [network, setNetwork] = useState(networks[0] ?? '');
  const [address, setAddress] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [alipayAccount, setAlipayAccount] = useState('');
  const [qr, setQr] = useState<QrRead>();
  const [qrComplaint, setQrComplaint] = useState<string>();
  const [reading, setReading] = useState(false);
  /** Номер попытки чтения: смена способа посреди чтения обесценивает результат. */
  const attempt = useRef(0);
  /**
   * Досмотрел ли человек поле до конца. Замечание показывается только
   * после этого: номер карты на четвёртой цифре не сходится по
   * контрольной сумме ни у кого.
   */
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Способ следует за валютой: у батов свои роды, у рублей свои.
    setKind((current) => (current && kinds.includes(current) ? current : kinds[0]));
  }, [kinds]);

  useEffect(() => {
    // Библиотека чтения QR подгружается при показе поля, а не при
    // выборе картинки: между выбором файла и ответом не должно быть
    // сетевого круга.
    if (kind === 'promptpay' || kind === 'alipay_qr') void import('@nemo/qr');
  }, [kind]);

  useEffect(() => {
    setNetwork((current) => current || (networks[0] ?? ''));
  }, [networks]);

  const needsHolder = kind !== undefined && requisiteHolderRequired(kind);

  /**
   * Черновик наружу: что не так с набранным и что отправлять, решают
   * правила из доменных типов — те же, что у формы Mini App и у отказа
   * операции. Пока заполнено не всё или набранное не похоже на правду,
   * отправлять нечего.
   */
  const draft = useMemo((): RecipientDraft & { readonly invalid: readonly RequisiteField[] } => {
    const fields = {
      kind,
      bankName,
      phone,
      cardNumber,
      network,
      address,
      accountNumber,
      holderName,
      alipayAccount,
      qr: qr && qr.kind === kind ? qr.payload : '',
    };
    const complaints = requisiteDraftComplaints(fields);
    const complaint = complaints[0]?.complaint;

    const payoutMethod =
      kind === undefined
        ? undefined
        : kind === 'promptpay'
          ? qr?.kind === 'promptpay'
            ? payoutMethodOf({ kind, promptpayIdType: qr.idType })
            : undefined
          : payoutMethodOf({ kind, promptpayIdType: null });

    return {
      input: complaint ? undefined : requisiteInputOf(fields),
      payoutMethod,
      complaint,
      invalid: complaints.map((one) => one.field),
    };
  }, [kind, bankName, phone, cardNumber, network, address, accountNumber, holderName, alipayAccount, qr]);
  const invalid = (field: RequisiteField) => draft.invalid.includes(field);
  const { complaint } = draft;

  /*
   * Наружу — по ссылке, а не через зависимости эффекта: обработчик
   * приходит новым при каждом рендере родителя, и с ним в зависимостях
   * черновик уходил бы наверх на каждый чужой рендер.
   */
  const notify = useRef(onChange);
  notify.current = onChange;
  useEffect(() => {
    const { invalid: _invalid, ...outward } = draft;
    notify.current(outward);
  }, [draft]);

  async function readPicture(file: File | undefined) {
    if (!file || !kind) return;
    const token = (attempt.current += 1);
    setQr(undefined);
    setQrComplaint(undefined);
    setReading(true);
    try {
      const { readQrFromImage } = await import('@nemo/qr');
      const payload = await readQrFromImage(file);
      if (token !== attempt.current) return;
      if (!payload) {
        setQrComplaint(REQUISITE_COMPLAINTS.noQr);
        return;
      }
      const reading = qrReadingOf(kind, payload);
      if (!reading.ok) {
        setQrComplaint(reading.complaint);
        return;
      }
      setQr({ ...reading, payload });
    } catch {
      if (token === attempt.current) {
        setQrComplaint('QR не удалось открыть. Попробуйте другой файл.');
      }
    } finally {
      if (token === attempt.current) setReading(false);
    }
  }

  function forgetQr() {
    attempt.current += 1;
    setQr(undefined);
    setQrComplaint(undefined);
    setReading(false);
  }

  const field = (bad: boolean) => ({
    'aria-invalid': checked && bad,
    className: checked && bad ? 'input input--wrong' : 'input',
    disabled,
  });

  if (kinds.length === 0) {
    return (
      <p className="muted">
        Получение {currency} переводом пока в разработке: реквизиты для этой валюты
        сервис ещё не принимает.
      </p>
    );
  }

  return (
    <div className="recipient">
      {kinds.length > 1 ? (
        <div className="field">
          <span className="label">Способ получения</span>
          <div className="chips" role="group" aria-label="Способ получения">
            {kinds.map((value) => (
              <button
                key={value}
                type="button"
                className={kind === value ? 'chip chip--on' : 'chip'}
                aria-pressed={kind === value}
                disabled={disabled}
                onClick={() => {
                  setKind(value);
                  setChecked(false);
                  forgetQr();
                }}
              >
                {REQUISITE_KIND_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="muted">{kind ? REQUISITE_KIND_LABELS[kind] : ''}</p>
      )}

      {kind === 'phone' || kind === 'card' || kind === 'account' ? (
        <div className="field">
          <label className="label" htmlFor="recipient-bank">
            Банк
          </label>
          <input
            id="recipient-bank"
            className="input"
            value={bankName}
            onChange={(event) => setBankName(event.target.value)}
            placeholder={kind === 'account' ? 'Например, Kasikornbank' : 'Например, Сбербанк'}
            disabled={disabled}
          />
          {/*
            Ярлыки под полем, а не список вместо него: мерчант заводит
            покупателей десятками, и латиница тайского банка набирается
            на клавиатуре дольше всего остального в форме. Банка, для
            которого ярлыка нет, это не касается — поле осталось
            свободным.

            Подпись при этом отвязана от поля меткой `for`, а не
            обёрткой: кнопки внутри `label` нажимались бы вместе с ним.
          */}
          <BankChips
            currency={currency}
            value={bankName}
            onPick={setBankName}
            disabled={disabled}
          />
        </div>
      ) : undefined}

      {kind === 'phone' ? (
        <label className="field">
          <span className="label">Телефон для перевода</span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            onBlur={() => setChecked(true)}
            placeholder="+7"
            inputMode="tel"
            {...field(invalid('phone'))}
          />
        </label>
      ) : undefined}

      {kind === 'card' ? (
        <label className="field">
          <span className="label">Номер карты</span>
          <input
            value={cardNumber}
            onChange={(event) => setCardNumber(groupCardDigits(event.target.value))}
            onBlur={() => setChecked(true)}
            placeholder="0000 0000 0000 0000"
            inputMode="numeric"
            autoComplete="off"
            {...field(invalid('card'))}
          />
        </label>
      ) : undefined}

      {kind === 'wallet' ? (
        <>
          <div className="field">
            <span className="label">Сеть</span>
            {networks.length === 0 ? (
              <p className="muted">
                Сети временно недоступны — напишите в поддержку, перевод отправят вручную.
              </p>
            ) : (
              <div className="chips" role="group" aria-label="Сеть">
                {networks.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={network === value ? 'chip chip--on' : 'chip'}
                    aria-pressed={network === value}
                    disabled={disabled}
                    onClick={() => setNetwork(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="field">
            <span className="label">
              {network ? `Адрес кошелька в сети ${network}` : 'Адрес кошелька'}
            </span>
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onBlur={() => setChecked(true)}
              placeholder="Адрес кошелька"
              autoComplete="off"
              spellCheck={false}
              {...field(invalid('address'))}
            />
          </label>
        </>
      ) : undefined}

      {kind === 'account' ? (
        <label className="field">
          <span className="label">Номер счёта</span>
          <input
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
            onBlur={() => setChecked(true)}
            placeholder="000-0-000000"
            inputMode="numeric"
            {...field(invalid('account'))}
          />
        </label>
      ) : undefined}

      {kind === 'alipay' ? (
        <label className="field">
          <span className="label">Телефон или e-mail аккаунта Alipay</span>
          <input
            value={alipayAccount}
            onChange={(event) => setAlipayAccount(event.target.value)}
            onBlur={() => setChecked(true)}
            placeholder="+86 или e-mail"
            {...field(invalid('alipay'))}
          />
        </label>
      ) : undefined}

      {kind === 'promptpay' || kind === 'alipay_qr' ? (
        <div className="field">
          <span className="label">
            {kind === 'promptpay' ? 'PromptPay-QR из банка или кошелька' : 'QR приёма Alipay'}
          </span>
          <div className="row__actions">
            {/*
              Картинка читается в браузере и на сервер не уходит. Тот же
              файл, выбранный снова, иначе не вызвал бы событие: поле
              помнит прошлый выбор.
            */}
            <label className="btn btn--soft">
              {reading ? 'Читаем QR…' : qr ? 'Выбрать другой QR' : 'Выбрать картинку с QR'}
              <input
                type="file"
                accept="image/*"
                disabled={reading || disabled}
                onChange={(event) => {
                  void readPicture(event.target.files?.[0]);
                  event.target.value = '';
                }}
                className="sr-only"
              />
            </label>
            {qr ? (
              <span className="muted" aria-live="polite">
                Распознано:{' '}
                {qr.kind === 'promptpay'
                  ? `PromptPay · ${PROMPTPAY_ID_LABELS[qr.idType]} ${qr.hint}`
                  : `Alipay · QR ${qr.hint}`}
              </span>
            ) : undefined}
          </div>
          {qrComplaint ? <p className="error">{qrComplaint}</p> : undefined}
        </div>
      ) : undefined}

      {needsHolder ? (
        <label className="field">
          <span className="label">Имя получателя</span>
          <input
            value={holderName}
            onChange={(event) => setHolderName(event.target.value)}
            onBlur={() => setChecked(true)}
            placeholder="IVAN PETROV"
            autoCapitalize="characters"
            {...field(invalid('holder'))}
          />
          <span className="cell__note">
            Как в приложении получателя: менеджер сверит его перед отправкой.
          </span>
        </label>
      ) : undefined}

      {/*
        Замечание к набранному — раньше сохранения, а не отказом после
        него. Отправленный по такому реквизиту перевод не возвращается.
      */}
      {checked && complaint ? <p className="error">{complaint}</p> : undefined}
    </div>
  );
}
