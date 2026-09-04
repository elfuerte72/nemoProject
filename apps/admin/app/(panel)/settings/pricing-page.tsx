'use client';

import type { DirectionView, FeeScheduleView, NetworkView } from '@nemo/core';
import { ExchangeDirections, FeeSchedules, TransferNetworks } from './pricing-forms';
import { useSettingsSend } from './use-settings-send';

/**
 * Три справочника на одной странице с одной строкой ошибки: гасят
 * направление и правят его сетку в один заход, и отказ ядра должен
 * стоять над тем, что правили, а не в трёх местах.
 */
export function PricingForms({
  networks,
  directions,
  feeSchedules,
}: {
  networks: readonly NetworkView[];
  directions: readonly DirectionView[];
  feeSchedules: readonly FeeScheduleView[];
}) {
  const { error, busy, send } = useSettingsSend();
  return (
    <>
      {error ? <p className="error">{error}</p> : undefined}
      <ExchangeDirections directions={directions} busy={busy} onToggle={send} />
      <FeeSchedules schedules={feeSchedules} directions={directions} busy={busy} onSend={send} />
      <TransferNetworks networks={networks} busy={busy} onToggle={send} />
    </>
  );
}
