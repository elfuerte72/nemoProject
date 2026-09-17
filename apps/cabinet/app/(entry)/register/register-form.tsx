'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { EntryBrand } from '@/app/ui/entry-brand';
import { send } from '@/app/ui/send';

/**
 * Анкета мерчанта.
 *
 * Реквизитов юрлица и договора здесь нет: договор — отношения владельца
 * с мерчантом вне системы, и спрашивать бумаги у того, кто ещё ничего
 * не сделал, значит терять его на первом экране. Спрашивается то, без
 * чего анкету нельзя рассмотреть: кто вы, чем занимаетесь и как с вами
 * связаться.
 *
 * Что считать правдоподобной почтой, паролем и телефоном, решает ядро:
 * форма отправляет как есть и показывает его слова. Проверка на месте
 * добавила бы второе правило, которое расходится с первым.
 */
export function RegisterForm() {
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    site: '',
    contactName: '',
    phone: '',
    about: '',
  });
  const [complaint, setComplaint] = useState<string>();
  const [busy, setBusy] = useState(false);

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setComplaint(undefined);
    setBusy(true);

    const result = await send('/api/auth/register', form);
    if (!result.ok) {
      setComplaint(result.complaint);
      setBusy(false);
      return;
    }

    window.location.href = '/check-email';
  }

  return (
    <main className="login">
      <div className="login__card login__card--wide">
        <EntryBrand />
        <p className="login__eyebrow">Заведение кабинета</p>
        <p className="muted">
          Кабинет — для бизнеса, который меняет через Tobee деньги: свои или своего
          покупателя. Мы подтвердим почту письмом, а затем рассмотрим анкету.
        </p>

        <form className="login__form" onSubmit={submit}>
          <div className="form-row">
            <Field
              label="Почта"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={set('email')}
            />
            <Field
              label="Пароль"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
              note="Не короче десяти знаков."
            />
          </div>
          <div className="form-row">
            <Field label="Название" value={form.name} onChange={set('name')} />
            <Field
              label="Сайт"
              value={form.site}
              onChange={set('site')}
              required={false}
              note="Необязательно."
            />
          </div>
          <div className="form-row">
            <Field
              label="Контактное лицо"
              value={form.contactName}
              onChange={set('contactName')}
            />
            <Field label="Телефон" type="tel" value={form.phone} onChange={set('phone')} />
          </div>

          <label className="field">
            <span className="label">Что собираетесь делать</span>
            <textarea
              className="input"
              rows={3}
              value={form.about}
              onChange={(event) => set('about')(event.target.value)}
            />
          </label>

          {complaint ? <p className="error">{complaint}</p> : undefined}

          <button type="submit" className="btn btn--gold btn--wide" disabled={busy}>
            {busy ? 'Отправляем…' : 'Завести кабинет'}
          </button>
        </form>

        <p className="muted">
          Кабинет уже есть? <Link href="/login">Войти</Link>
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  required = true,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly autoComplete?: string;
  readonly required?: boolean;
  readonly note?: string;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input
        className="input"
        type={type}
        {...(autoComplete ? { autoComplete } : {})}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
      {note ? <span className="cell__note">{note}</span> : undefined}
    </label>
  );
}
