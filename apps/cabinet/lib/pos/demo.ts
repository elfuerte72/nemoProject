import { Money, type Amount } from '@nemo/types';
import type { MockInvoice, MockRefund } from '../invoice-rows';
import { buyerPays, makeInvoice, nextNumber } from '../pos';
import { IMITATION } from './imitation';
import { cancelledByHand, expireDue, paidByProvider, withNote } from './lifecycle';

/**
 * Примеры счетов и возвратов — чтобы экраны терминала можно было
 * смотреть и показывать до первого настоящего платежа.
 *
 * Заводятся только по просьбе (`POS_DEMO_SEED=1` в окружении) и только
 * мерчанту, у которого счетов ещё нет: на боевом контуре у живого
 * мерчанта примерные счета читались бы как его продажи. Каждый пример
 * подписан словом «пример» в списке и в карточке.
 *
 * Набор один и тот же при каждом запуске: числа в примерах — не
 * случайность, а то, что показывают заказчику, и «вчера было
 * восемнадцать тысяч, сегодня двенадцать» не должно случаться от
 * перезапуска.
 */

export const DEMO_AUTHOR = 'Пример';

/** Просили ли примеры. Слово «да» — на случай русской руки в `.env`. */
export function demoAsked(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return /^(1|true|yes|да)$/iu.test(env.POS_DEMO_SEED?.trim() ?? '');
}

/** Столько живёт счёт в примерах — как у образца. */
const TTL_MINUTES = 60;

/** Курс «валюта за 1 RUB» в примерах: близкий к рынку осени 2026, но не живой. */
const RATES: Readonly<Record<string, string>> = {
  THB: '0.37',
  CNY: '0.0815',
  USDT: '0.0114',
};

interface Sample {
  readonly daysAgo: number;
  readonly hour: number;
  readonly code: string;
  readonly amount: string;
  readonly buyer: string;
  readonly purpose: string;
  readonly outcome: 'paid' | 'expired' | 'cancelled' | 'issued';
  readonly kyc?: boolean;
  readonly refund?: { readonly amount: string; readonly reason: string };
}

const SAMPLES: readonly Sample[] = [
  { daysAgo: 9, hour: 11, code: 'THB', amount: '1500', buyer: 'Анна', purpose: 'Маникюр', outcome: 'paid' },
  { daysAgo: 9, hour: 15, code: 'CNY', amount: '300', buyer: 'Олег', purpose: 'Сувениры', outcome: 'expired' },
  {
    daysAgo: 8,
    hour: 16,
    code: 'THB',
    amount: '4200',
    buyer: 'Мария',
    purpose: 'Ужин на четверых',
    outcome: 'paid',
    refund: { amount: '1200', reason: 'Одно блюдо не принесли' },
  },
  { daysAgo: 7, hour: 10, code: 'USDT', amount: '150', buyer: 'Дмитрий', purpose: 'Аренда байка на неделю', outcome: 'paid', kyc: true },
  { daysAgo: 7, hour: 15, code: 'THB', amount: '900', buyer: 'Ирина', purpose: 'Массаж', outcome: 'expired' },
  { daysAgo: 6, hour: 9, code: 'THB', amount: '2600', buyer: 'Сергей', purpose: 'Экскурсия на острова', outcome: 'paid' },
  { daysAgo: 5, hour: 13, code: 'CNY', amount: '1200', buyer: 'Наталья', purpose: 'Оплата отеля', outcome: 'cancelled' },
  {
    daysAgo: 5,
    hour: 14,
    code: 'THB',
    amount: '700',
    buyer: 'Павел',
    purpose: 'Стрижка',
    outcome: 'paid',
    refund: { amount: '700', reason: 'Передумал, услугу не оказали' },
  },
  { daysAgo: 4, hour: 8, code: 'THB', amount: '3100', buyer: 'Елена', purpose: 'Трансфер в аэропорт', outcome: 'paid' },
  { daysAgo: 3, hour: 12, code: 'USDT', amount: '60', buyer: 'Артём', purpose: 'Сим-карта', outcome: 'expired' },
  { daysAgo: 2, hour: 16, code: 'THB', amount: '1800', buyer: 'Ксения', purpose: 'Маникюр и педикюр', outcome: 'paid', kyc: true },
  { daysAgo: 1, hour: 13, code: 'CNY', amount: '850', buyer: 'Виктор', purpose: 'Ужин', outcome: 'paid' },
  { daysAgo: 1, hour: 16, code: 'THB', amount: '1200', buyer: 'Ольга', purpose: 'Массаж', outcome: 'expired' },
  { daysAgo: 0, hour: -1, code: 'THB', amount: '2000', buyer: 'Анна', purpose: 'Маникюр', outcome: 'issued' },
];

/**
 * Время примера: столько дней назад, в такой час по UTC; отрицательный
 * час — столько часов назад. Часы в наборе не позже 16 UTC: номер счёта
 * считается по UTC, а смотрят на него из Москвы и Бангкока, и пример,
 * заведённый в 21 UTC, назывался бы вчерашним числом у сегодняшнего.
 */
function sampleTime(sample: Sample, now: Date): Date {
  if (sample.hour < 0) return new Date(now.getTime() + sample.hour * 3_600_000);
  const day = new Date(now.getTime() - sample.daysAgo * 86_400_000);
  day.setUTCHours(sample.hour, 12, 0, 0);
  return day;
}

export interface DemoSet {
  readonly invoices: readonly MockInvoice[];
  readonly refunds: readonly MockRefund[];
}

/**
 * Собрать примеры на этот момент. Счёт «ожидает» заведён час назад со
 * сроком в сорок минут вперёд, чтобы на нём можно было показать QR и
 * имитацию оплаты; когда срок выйдет, он истечёт сам, как настоящий.
 */
export function demoSet(now: Date): DemoSet {
  const invoices: MockInvoice[] = [];
  const refunds: MockRefund[] = [];

  const ordered = [...SAMPLES].sort(
    (a, b) => sampleTime(a, now).getTime() - sampleTime(b, now).getTime(),
  );

  for (const sample of ordered) {
    const at = sampleTime(sample, now);
    const rate = Money.toAmount(RATES[sample.code] ?? '1');
    const amount = Money.toAmount(sample.amount);
    const pay = buyerPays(Money.divide(amount, rate));
    const expiresAt =
      sample.outcome === 'issued'
        ? new Date(now.getTime() + 40 * 60_000)
        : new Date(at.getTime() + TTL_MINUTES * 60_000);

    let invoice = makeInvoice({
      number: nextNumber(invoices, at),
      purpose: sample.purpose,
      buyer: sample.buyer,
      author: DEMO_AUTHOR,
      code: sample.code,
      amount,
      payCode: 'RUB',
      payAmount: pay,
      rate: Money.divide(amount, pay),
      markupBps: 0,
      kycRequired: sample.kyc ?? false,
      at,
      expiresAt,
      demo: true,
    });
    invoice = { ...invoice, payment: { provider: IMITATION, ref: `imit_${invoice.id}` } };

    if (sample.outcome === 'paid') {
      invoice = paidByProvider(invoice, {
        at: new Date(at.getTime() + 4 * 60_000),
        providerTitle: 'Имитация',
      });
    } else if (sample.outcome === 'cancelled') {
      invoice = cancelledByHand(invoice, new Date(at.getTime() + 9 * 60_000));
    } else if (sample.outcome === 'expired') {
      invoice = expireDue(invoice, now);
    }

    if (sample.refund && invoice.status === 'paid') {
      const asked = new Date(at.getTime() + 86_400_000);
      const refundAmount = Money.toAmount(sample.refund.amount);
      const full = Money.compare(refundAmount, invoice.amount) === 0;
      refunds.push({
        id: `ref_demo_${invoice.id}`,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        code: invoice.code,
        amount: refundAmount,
        retained: full ? null : Money.subtract(invoice.amount, refundAmount),
        reason: sample.refund.reason,
        status: 'done',
        createdAt: asked.toISOString(),
        doneAt: asked.toISOString(),
        provider: IMITATION,
        demo: true,
      });
      invoice = withNote(invoice, asked, `Заявлен возврат: ${sample.refund.reason}`);
      invoice = withNote(invoice, asked, 'Возврат исполнен: провайдер «Имитация»');
    }

    invoices.push(invoice);
  }

  // Новыми сверху, как хранит память макета.
  return { invoices: invoices.reverse(), refunds: refunds.reverse() };
}

/** Сколько рублей в примерах платят за сумму в валюте: тестам и только им. */
export function demoPay(code: string, amount: Amount): Amount {
  return buyerPays(Money.divide(amount, Money.toAmount(RATES[code] ?? '1')));
}
