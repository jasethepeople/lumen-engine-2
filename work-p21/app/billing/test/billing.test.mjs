/**
 * @lumen/app-billing — unit tests (node --test) against compiled output.
 * Run: npm run build && node --test test/
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PLANS,
  FREE_PLAN_ID,
  PRO_PLAN_ID,
  getPlan,
  isPlanId,
  MemoryBillingStorage,
  LocalStorageBillingAdapter,
  MockBillingProvider,
  PERIOD_MS,
} from '../dist/index.js';

const T0 = 1_700_000_000_000;
const fixedClock = () => T0;

test('plan catalog: free and pro exist with descriptors', () => {
  assert.ok(isPlanId('free'));
  assert.ok(isPlanId('pro'));
  assert.equal(isPlanId('enterprise'), false);

  const free = getPlan('free');
  assert.equal(free.id, FREE_PLAN_ID);
  assert.equal(free.priceMonthly, 0);
  assert.ok(Array.isArray(free.features) && free.features.length > 0);

  const pro = getPlan('pro');
  assert.equal(pro.id, PRO_PLAN_ID);
  assert.ok(pro.priceMonthly > 0);
  assert.ok(pro.features.length > free.features.length);

  // Catalog keys match descriptor ids.
  for (const [key, plan] of Object.entries(PLANS)) {
    assert.equal(plan.id, key);
    assert.equal(typeof plan.name, 'string');
    assert.equal(typeof plan.priceMonthly, 'number');
  }
});

test('default subscription: unknown user is on free, active', async () => {
  const provider = new MockBillingProvider({ clock: fixedClock });
  const sub = await provider.getSubscription('u-new');
  assert.equal(sub.planId, FREE_PLAN_ID);
  assert.equal(sub.status, 'active');
  assert.equal(sub.currentPeriodEnd, T0 + PERIOD_MS);
  assert.equal(sub.updatedAt, T0);
});

test('checkout: completes immediately and activates plan', async () => {
  const provider = new MockBillingProvider({ clock: fixedClock });
  const session = await provider.checkout('u1', 'pro');
  assert.equal(session.status, 'completed');
  assert.equal(session.userId, 'u1');
  assert.equal(session.planId, 'pro');
  assert.equal(session.createdAt, T0);
  assert.ok(session.id.length > 0);

  const sub = await provider.getSubscription('u1');
  assert.equal(sub.planId, 'pro');
  assert.equal(sub.status, 'active');
  assert.equal(sub.currentPeriodEnd, T0 + PERIOD_MS);
});

test('checkout: unknown plan id throws', async () => {
  const provider = new MockBillingProvider({ clock: fixedClock });
  await assert.rejects(() => provider.checkout('u1', 'gold'), /unknown plan/);
});

test('cancel: reverts to free with canceled status', async () => {
  const provider = new MockBillingProvider({ clock: fixedClock });
  await provider.checkout('u1', 'pro');
  const canceled = await provider.cancel('u1');
  assert.equal(canceled.planId, FREE_PLAN_ID);
  assert.equal(canceled.status, 'canceled');
  assert.equal(canceled.currentPeriodEnd, T0);
  assert.equal(canceled.updatedAt, T0);

  const sub = await provider.getSubscription('u1');
  assert.equal(sub.status, 'canceled');
  assert.equal(sub.planId, FREE_PLAN_ID);
});

test('cancel: works for a user who never checked out', async () => {
  const provider = new MockBillingProvider({ clock: fixedClock });
  const canceled = await provider.cancel('ghost');
  assert.equal(canceled.status, 'canceled');
  assert.equal(canceled.planId, FREE_PLAN_ID);
});

test('storage isolation: subscriptions do not leak between users', async () => {
  const provider = new MockBillingProvider({ clock: fixedClock });
  await provider.checkout('u1', 'pro');
  const other = await provider.getSubscription('u2');
  assert.equal(other.planId, FREE_PLAN_ID);
});

test('MemoryBillingStorage: CRUD + defensive copies', () => {
  const storage = new MemoryBillingStorage();
  const sub = {
    userId: 'u',
    planId: 'pro',
    status: 'active',
    currentPeriodEnd: 1,
    updatedAt: 0,
  };
  storage.set(sub);
  const got = storage.get('u');
  assert.deepEqual(got, sub);
  got.planId = 'free';
  assert.equal(storage.get('u').planId, 'pro');
  assert.equal(storage.all().length, 1);
  storage.delete('u');
  assert.equal(storage.get('u'), undefined);
});

test('LocalStorageBillingAdapter: falls back to memory outside the browser', async () => {
  assert.equal(typeof globalThis.localStorage, 'undefined');
  const adapter = new LocalStorageBillingAdapter();
  const provider = new MockBillingProvider({ storage: adapter, clock: fixedClock });
  await provider.checkout('u1', 'pro');
  const sub = await provider.getSubscription('u1');
  assert.equal(sub.planId, 'pro');
  assert.equal(adapter.all().length, 1);
});

test('LocalStorageBillingAdapter: persists into an injected Web Storage', () => {
  const backing = new Map();
  const storage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
    key: (i) => [...backing.keys()][i] ?? null,
    get length() {
      return backing.size;
    },
  };
  const adapter = new LocalStorageBillingAdapter({ storage });
  adapter.set({ userId: 'u', planId: 'pro', status: 'active', currentPeriodEnd: 1, updatedAt: 0 });
  assert.equal(adapter.get('u').planId, 'pro');
  assert.equal(adapter.all().length, 1);
  adapter.delete('u');
  assert.equal(adapter.get('u'), undefined);
});

test('provider accepts a pluggable storage shared across instances', async () => {
  const storage = new MemoryBillingStorage();
  const a = new MockBillingProvider({ storage, clock: fixedClock });
  await a.checkout('u1', 'pro');
  const b = new MockBillingProvider({ storage, clock: fixedClock });
  assert.equal((await b.getSubscription('u1')).planId, 'pro');
});
