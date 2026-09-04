'use client';

import { useState } from 'react';
import type { ServiceSettingsView } from '@nemo/core';
import { bpsToPercent, percentToBps } from '@/lib/percent';
import { useSettingsSend } from './use-settings-send';

/**
 * Экономика сервиса: наценка, минимум обмена, срок оплаты, ставки
 * реферальных линий и порог вывода.
 *
 * Смена ставок действует вперёд: уже сделанные начисления не
 * пересчитываются, потому что ставка, по которой начислено, хранится в
 * самом движении баллов. Экран говорит об этом прямо — иначе
 * администратор ждал бы пересчёта и не понимал, почему его нет.
 *
 * Две карточки на одной странице: наценка, минимум и срок складываются
 * в доход сервиса, ставки линий из него же выплачиваются, и
 * разнесённые по разным подразделам они не читались бы вместе.
 */
export function EconomyForms({ settings }: { settings: ServiceSettingsView }) {
  const { error, busy, send } = useSettingsSend();

  const [markup, setMarkup] = useState(bpsToPercent(settings.markupBps));
  const [minExchange, setMinExchange] = useState<string>(settings.minExchangeAmount);
  const [ttlMinutes, setTtlMinutes] = useState(String(settings.unpaidExchangeRequestTtlMinutes));

  const [line1, setLine1] = useState(bpsToPercent(settings.referralLine1Bps));
  const [line2, setLine2] = useState(bpsToPercent(settings.referralLine2Bps));
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
        <h2 className="card__title">Ставки линий и вывод</h2>
        <p className="card__note">
          Ставка задаётся в процентах от дохода сервиса по заявке; шаг — сотая процента.
          Уже сделанные начисления от смены ставки не меняются — заявка исполнена на тех
          условиях, что действовали в момент её исполнения.
        </p>
        <div className="form-row">
          <label className="field">
            <span className="label">Первая линия, %</span>
            <input
              className="input"
              value={line1}
              onChange={(event) => setLine1(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field">
            <span className="label">Вторая линия, %</span>
            <input
              className="input"
              value={line2}
              onChange={(event) => setLine2(event.target.value)}
              inputMode="decimal"
            />
          </label>
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
          {/*
            Кнопка гаснет на нечисловой ставке: отправленная, она
            вернулась бы отказом ядра про неверное значение — а
            администратор видит перед собой поле, в котором опечатка.
          */}
          <button
            type="button"
            disabled={busy || percentToBps(line1) === null || percentToBps(line2) === null}
            className="btn btn--gold"
            onClick={() =>
              send('/api/settings', {
                referralLine1Bps: percentToBps(line1),
                referralLine2Bps: percentToBps(line2),
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
