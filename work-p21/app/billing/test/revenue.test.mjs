/**
 * @lumen/app-billing — Phase 15 RevenueShareLedger tests.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CREATOR_SHARE_RATIO,
  PLATFORM_SHARE_RATIO,
  RevenueShareLedger,
} from '../dist/index.js';

const fixedClock = () => 1_700_000_000_000;

test('share ratios are 30/70', () => {
  assert.equal(PLATFORM_SHARE_RATIO, 0.3);
  assert.equal(CREATOR_SHARE_RATIO, 0.7);
});

test('split math: creator 70% rounded, platform remainder, sums exactly', () => {
  const ledger = new RevenueShareLedger(fixedClock);

  const e1 = ledger.recordPurchase({ purchaseId: 'p1', authorId: 'alice', amountCents: 2900 });
  assert.equal(e1.creatorShareCents, 2030);
  assert.equal(e1.platformShareCents, 870);

  // Odd-cent amount: round(99 * 0.7) = 69, platform takes 30; sums to 99.
  const e2 = ledger.recordPurchase({ purchaseId: 'p2', authorId: 'alice', amountCents: 99 });
  assert.equal(e2.creatorShareCents, 69);
  assert.equal(e2.platformShareCents, 30);

  const e3 = ledger.recordPurchase({ purchaseId: 'p3', authorId: 'bob', amountCents: 1000 });
  assert.equal(e3.creatorShareCents, 700);
  assert.equal(e3.platformShareCents, 300);

  for (const e of [e1, e2, e3]) {
    assert.equal(e.creatorShareCents + e.platformShareCents, e.amountCents);
    assert.equal(e.recordedAt, 1_700_000_000_000);
  }
  assert.equal(ledger.list().length, 3);
});

test('invalid amounts are rejected', () => {
  const ledger = new RevenueShareLedger(fixedClock);
  assert.throws(() => ledger.recordPurchase({ purchaseId: 'p', authorId: 'a', amountCents: -5 }));
  assert.throws(() => ledger.recordPurchase({ purchaseId: 'p', authorId: 'a', amountCents: 1.5 }));
  assert.equal(ledger.list().length, 0);
});

test('creatorEarnings and platformRevenue aggregate correctly', () => {
  const ledger = new RevenueShareLedger(fixedClock);
  ledger.recordPurchase({ purchaseId: 'p1', authorId: 'alice', amountCents: 2900 });
  ledger.recordPurchase({ purchaseId: 'p2', authorId: 'alice', amountCents: 99 });
  ledger.recordPurchase({ purchaseId: 'p3', authorId: 'bob', amountCents: 1000 });

  assert.equal(ledger.creatorEarnings('alice'), 2030 + 69);
  assert.equal(ledger.creatorEarnings('bob'), 700);
  assert.equal(ledger.creatorEarnings('nobody'), 0);
  assert.equal(ledger.platformRevenue(), 870 + 30 + 300);
});

test('requestPayout: scheduled stub, settles outstanding balance, no transfer', () => {
  const ledger = new RevenueShareLedger(fixedClock);
  ledger.recordPurchase({ purchaseId: 'p1', authorId: 'alice', amountCents: 2900 });
  ledger.recordPurchase({ purchaseId: 'p2', authorId: 'alice', amountCents: 99 });
  ledger.recordPurchase({ purchaseId: 'p3', authorId: 'bob', amountCents: 1000 });

  const payout = ledger.requestPayout('alice');
  assert.equal(payout.status, 'scheduled');
  assert.equal(payout.amountCents, 2099);
  assert.equal(payout.authorId, 'alice');
  assert.ok(payout.payoutId.startsWith('payout_'));
  assert.equal(payout.requestedAt, 1_700_000_000_000);

  // Outstanding balance settled; lifetime earnings unchanged.
  assert.equal(ledger.creatorEarnings('alice', { outstandingOnly: true }), 0);
  assert.equal(ledger.creatorEarnings('alice'), 2099);
  // Bob untouched.
  assert.equal(ledger.creatorEarnings('bob', { outstandingOnly: true }), 700);

  // Second payout with nothing outstanding schedules a zero payout.
  const empty = ledger.requestPayout('alice');
  assert.equal(empty.status, 'scheduled');
  assert.equal(empty.amountCents, 0);

  // New sale after payout becomes the next outstanding balance.
  ledger.recordPurchase({ purchaseId: 'p4', authorId: 'alice', amountCents: 1000 });
  assert.equal(ledger.creatorEarnings('alice', { outstandingOnly: true }), 700);
});
