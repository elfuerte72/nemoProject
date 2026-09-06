import { describe, expect, it } from 'vitest';
import type { ManagerExchangeRequestView } from '@nemo/core';
import { coreFilterFor, partyOf, sayParty, toExchangeRow } from './exchange-rows';

/**
 * Кто подал заявку — в строке стола.
 *
 * У клиента ник и номер, у мерчанта название и его собственный номер
 * сделки: строка «Без ника · ID» у мерчантской заявки читалась бы как
 * клиент, о котором ничего не известно.
 */

const BASE = {
  id: 'r1',
  kind: 'electronic',
  fromCode: 'USDT',
  toCode: 'RUB',
  fromAmount: '100',
  toAmount: '8000',
  requestRate: '80',
  finalRate: null,
  status: 'new',
  requisitesIssuedAt: null,
  requisitesId: null,
  paymentInstructions: null,
  cancelReason: null,
  reference: null,
  createdAt: new Date('2026-09-06T10:00:00Z'),
  updatedAt: new Date('2026-09-06T10:00:00Z'),
  completedAt: null,
  assignedManagerId: null,
  assignedManagerName: null,
  serviceIncome: null,
  serviceIncomeCode: null,
  serviceAccountId: null,
  clientUsername: null,
  merchantName: null,
} as unknown as ManagerExchangeRequestView;

function asClient(username: string | null): ManagerExchangeRequestView {
  return { ...BASE, owner: { kind: 'client', clientId: 100n }, clientUsername: username };
}

function asMerchant(reference: string | null): ManagerExchangeRequestView {
  return {
    ...BASE,
    owner: { kind: 'merchant', merchantId: 'm1' },
    merchantName: 'Оплатишка',
    reference,
  };
}

describe('кто подал заявку', () => {
  it('у клиента — ник и номер', () => {
    expect(partyOf(asClient('ivan'))).toEqual({
      kind: 'client',
      clientId: '100',
      username: 'ivan',
    });
    expect(sayParty(partyOf(asClient('ivan')))).toBe('@ivan');
    expect(sayParty(partyOf(asClient(null)))).toBe('100');
  });

  it('у мерчанта — название и его номер сделки', () => {
    expect(partyOf(asMerchant('booking-1024'))).toEqual({
      kind: 'merchant',
      name: 'Оплатишка',
      reference: 'booking-1024',
    });
    expect(sayParty(partyOf(asMerchant('booking-1024')))).toBe('Оплатишка · booking-1024');
    expect(sayParty(partyOf(asMerchant(null)))).toBe('Оплатишка');
  });

  /**
   * Мерчант из заявки не пропадает: на него ссылается строка, и удалить
   * его база не даст. Пустое имя означало бы сломанную ссылку, и молчать
   * об этом в столе нельзя.
   */
  it('мерчант без имени назван прямо, а не пустой строкой', () => {
    const broken = { ...asMerchant(null), merchantName: null };
    expect(sayParty(partyOf(broken))).toBe('мерчант удалён');
  });

  it('строка стола несёт владельца, а не два необязательных поля', () => {
    expect(toExchangeRow(asMerchant('booking-1024'))).toMatchObject({
      party: { kind: 'merchant', name: 'Оплатишка' },
    });
  });
});

describe('сужение стола', () => {
  const empty = { q: '', kind: '', status: '', merchant: '' };

  it('фильтр по мерчанту доезжает до ядра во всех трёх разделах', () => {
    for (const scope of ['mine', 'queue', 'others'] as const) {
      expect(coreFilterFor(scope, { ...empty, merchant: 'm1' })).toMatchObject({
        merchantId: 'm1',
      });
    }
  });

  it('без мерчанта поля в фильтре нет вовсе', () => {
    expect(coreFilterFor('queue', empty)).not.toHaveProperty('merchantId');
  });
});
