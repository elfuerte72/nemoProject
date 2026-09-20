'use client';

import { useState } from 'react';
import type { ServiceSettingsView } from '@nemo/core';
import { decimalFromInput } from '@/lib/decimal-input';
import { bpsToPercent, percentToBps } from '@/lib/percent';
import { useSettingsSend } from './use-settings-send';

/**
 * Экономика обмена: наценка, минимум обмена, срок оплаты. Всё про
 * баллы — ставки линий, уровни, порог вывода — с 8 сентября 2026 в
 * подразделе «Рефералка»: линий стало до пяти, а с ними уровни и
 * личные ставки, и двумя полями это уже не выразить.
 */
export function EconomyForms({
  settings,
  warningMinutes,
}: {
  settings: ServiceSettingsView;
  /**
   * За сколько до конца срока бот предупреждает клиента. Приходит из
   * ядра через страницу, а не набрано здесь числом: правило одно, и
   * своя копия разошлась бы с ним молча.
   */
  warningMinutes: number;
}) {
  const { error, busy, send } = useSettingsSend();

  const [markup, setMarkup] = useState(bpsToPercent(settings.markupBps));
  const [minExchange, setMinExchange] = useState<string>(settings.minExchangeAmount);
  const [ttlMinutes, setTtlMinutes] = useState(String(settings.unpaidExchangeRequestTtlMinutes));

  /*
   * Короткий срок отменяет предупреждение целиком: «за полчаса»
   * пришлось бы на момент выдачи реквизитов или раньше, и ядро такое
   * предупреждение не шлёт. Администратор узнаёт об этом до сохранения,
   * а не из жалобы клиента, которому пришла отмена без предупреждения.
   */
  const entered = Number(ttlMinutes);
  const silentExpiry = Number.isFinite(entered) && entered > 0 && entered <= warningMinutes;

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
        {silentExpiry ? (
          <p className="card__note">
            При сроке {warningMinutes} минут и меньше клиент не получит предупреждения о
            скором истечении: оно уходит за {warningMinutes} минут до конца, а здесь
            пришлось бы на момент выдачи реквизитов. Клиент увидит реквизиты, а
            следующим сообщением — отмену.
          </p>
        ) : undefined}
        <div className="row__actions">
          <button
            type="button"
            disabled={busy || percentToBps(markup) === null}
            className="btn btn--gold"
            onClick={() =>
              send('/api/settings', {
                markupBps: percentToBps(markup),
                minExchangeAmount: decimalFromInput(minExchange),
                unpaidExchangeRequestTtlMinutes: Number(ttlMinutes),
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
