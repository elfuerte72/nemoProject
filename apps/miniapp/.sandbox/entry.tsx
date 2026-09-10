import { createRoot } from 'react-dom/client';
import type { BonusAccountView, MyReferralsPage, ReferralCabinetStats } from '@nemo/core';
import { ReferralsBlock, ReferralStats, TierCard } from '../app/referral-cabinet';

declare global {
  interface Window {
    Telegram?: unknown;
  }
}

(window as unknown as { Telegram: unknown }).Telegram = {
  WebApp: { initData: 'stub', initDataUnsafe: {}, HapticFeedback: { notificationOccurred() {}, impactOccurred() {} } },
};

const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
const account = {
  balance: '1250',
  earned: '1980',
  referralCode: 'X5C4MZV8TB',
  lines: [
    { line: 1, count: 12, rateBps: 800, source: 'tier', tierName: 'Серебро' },
    { line: 2, count: 7, rateBps: 400, source: 'individual', tierName: null },
    { line: 3, count: 2, rateBps: 100, source: 'base', tierName: null },
  ],
  tier: {
    current: { id: 't1', name: 'Серебро', minActiveReferrals: 3, rates: [], createdAt: new Date() },
    next: { id: 't2', name: 'Золото', minActiveReferrals: 10, rates: [], createdAt: new Date() },
    activeReferrals: 6,
    toNext: 4,
  },
  codes: [],
  canEnterPromo: false,
  minWithdrawalAmount: '1000',
  history: [],
} as unknown as BonusAccountView;

const stats = {
  period: { from: new Date(), to: new Date() },
  current: {
    joined: 5, joinedByLine: [{ line: 1, count: 3 }, { line: 2, count: 2 }, { line: 3, count: 0 }],
    activated: 2, accrued: '640', accruals: 9, paid: '300',
    turnover: [{ code: 'RUB', amount: '124000', count: 3 }, { code: 'USDT', amount: '850', count: 6 }],
  },
  previous: { joined: 3, joinedByLine: [], activated: 3, accrued: '410', accruals: 5, paid: '0', turnover: [] },
  pending: '500',
  byDay: Array.from({ length: 14 }, (_, i) => ({ day: day(13 - i), joined: [0,1,0,0,2,0,0,0,1,0,0,0,1,0][i]!, accrued: ['0','50','0','120','0','0','80','0','0','200','0','40','0','150'][i]! })),
  codes: [],
} as unknown as ReferralCabinetStats;

const page = {
  items: [
    { joinedAt: new Date(Date.now() - 2 * 86_400_000), line: 1, via: { label: 'Основная', kind: 'link' }, active: true, completedCount: 3, brought: '180', lastExchangeAt: new Date() },
    { joinedAt: new Date(Date.now() - 5 * 86_400_000), line: 1, via: { label: 'Лето', kind: 'promo' }, active: false, completedCount: 0, brought: '0', lastExchangeAt: null },
    { joinedAt: new Date(Date.now() - 9 * 86_400_000), line: 2, via: null, active: true, completedCount: 1, brought: '20', lastExchangeAt: new Date(Date.now() - 86_400_000) },
  ],
  total: 21,
  nextOffset: 3,
} as unknown as MyReferralsPage;

window.fetch = async (input) => {
  const url = String(input);
  const body = url.includes('/api/referral-stats') ? { stats } : url.includes('/api/referrals') ? { page } : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

createRoot(document.getElementById('root')!).render(
  <div className="app">
    <div className="frame">
      <div className="track">
        <div className="track__slot" style={{ padding: '16px 16px 60px' }}>
          <TierCard account={account} />
          <ReferralStats revisit={0} />
          <ReferralsBlock revisit={0} />
        </div>
      </div>
    </div>
  </div>,
);
