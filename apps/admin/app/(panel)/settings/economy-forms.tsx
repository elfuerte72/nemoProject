'use client';

import { useState } from 'react';
import type { ServiceSettingsView } from '@nemo/core';
import { bpsToPercent, percentToBps } from '@/lib/percent';
import { useSettingsSend } from './use-settings-send';

/**
 * Экономика сервиса: наценка, минимум обмена, срок оплаты и порог
 * вывода баллов. Ставки реферальных линий с 8 сентября 2026 — в
 * реферальной программе: линий стало до пяти, а с ними уровни и личные
 * ставки, и двумя полями это уже не выразить.
 */
export function EconomyForms({ settings }: { settings: ServiceSettingsView }) {
  const { error, busy, send } = useSettingsSend();

  const [markup, setMarkup] = useState(bpsToPercent(settings.markupBps));
  const [minExchange, setMinExchange] = useState<string>(settings.minExchangeAmount);
  const [ttlMinutes, setTtlMinutes] = useState(String(settings.unpaidExchangeRequestTtlMinutes));

  const [minWithdrawal, setMinWithdrawal] = useState<string>(settings.minWithdrawalAmount);

  return (
    <>
      {error ? <p className="error">{error}</p> : undefined}

      <section className="card">
        <h2 className="card__title">Экономика обмена</h2>
        <p className="card__note">
          Наценка одна на весь сервис, задаётся в процентах и действует во все стороны:
          она вычитается из курса, и клиент видит сумму уже с ней. Минимальная сумма
          задана в USDT — эту валюту клиент отдаёт или получает в каждом направлении,
          поэтому порог действует на весь список сразу. При наценке в пару процентов
          мелкий обмен не покрывает комиссию сети, которую сервис платит за клиента.
          Срок отсчитывается с момента, когда менеджер выдал реквизиты для оплаты.
        </p>
        <div className="form-row">
          <label className="field">
            <span className="label">Наценка, %</span>
            <input
              className="input"
              value={markup}
              onChange={(event) => setMarkup(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field">
            <span className="label">Минимум обмена, USDT</span>
            <input
              className="input"
              value={minExchange}
              onChange={(event) => setMinExchange(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field">
            <span className="label">Срок оплаты, минут</span>
            <input
              className="input"
              value={ttlMinutes}
              onChange={(event) => setTtlMinutes(event.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>
        <div className="row__actions">
          <button
            type="button"
            disabled={busy || percentToBps(markup) === null}
            className="btn btn--gold"
            onClick={() =>
              send('/api/settings', {
                markupBps: percentToBps(markup),
                minExchangeAmount: minExchange.replace(',', '.').trim(),
                unpaidExchangeRequestTtlMinutes: Number(ttlMinutes),
              })
            }
          >
            Сохранить
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Вывод баллов</h2>
        <p className="card__note">
          Ниже этого порога заявка на вывод не принимается; клиент видит порог рядом с
          балансом. Ставки линий, уровни и личные ставки — в реферальной программе.
        </p>
        <div className="form-row">
          <label className="field">
            <span className="label">Минимум на вывод, баллов</span>
            <input
              className="input"
              value={minWithdrawal}
              onChange={(event) => setMinWithdrawal(event.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>
        <div className="row__actions">
          <button
            type="button"
            disabled={busy}
            className="btn btn--gold"
            onClick={() =>
              send('/api/settings', {
                minWithdrawalAmount: minWithdrawal.replace(',', '.').trim(),
              })
            }
          >
            Сохранить
          </button>
        </div>
      </section>
    </>
  );
}
