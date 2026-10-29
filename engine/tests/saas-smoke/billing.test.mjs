/**
 * tests/saas-smoke — (j) billing/entitlements: free user blocked from pro
 * template, pro plan switch unlocks; telemetry default-off asserted.
 *
 * Entitlements + telemetry ARE real offline facade slots (the facade
 * delegates to @lumen/app-entitlements EntitlementService and
 * @lumen/app-telemetry createTelemetryClient); billing uses the real
 * @lumen/app-billing MockBillingProvider, composed exactly like the
 * Builder's services.ts plan-resolver pattern.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineBackend } from '@lumen/backend-supabase';
import {
  FREE_PLAN_ID,
  MockBillingProvider,
  PRO_PLAN_ID,
} from '@lumen/app-billing';
import { EntitlementService, canAccessTemplate } from '@lumen/app-entitlements';

const USER = 'smoke-user';

test('(j) free user blocked from pro template; pro switch unlocks', async () => {
  const backend = createOfflineBackend();
  const billing = new MockBillingProvider({ clock: () => 1_700_000_000_000 });

  // The Builder's plan-resolver pattern: EntitlementService is synchronous,
  // so a cached plan id is refreshed after every billing mutation.
  let currentPlanId = FREE_PLAN_ID;
  const refreshPlan = async () => {
    const sub = await billing.getSubscription(USER);
    currentPlanId = sub.status === 'active' || sub.status === 'trialing'
      ? sub.planId
      : FREE_PLAN_ID;
    return currentPlanId;
  };
  const entitlements = new EntitlementService(() => currentPlanId);

  // Offline facade entitlements start on the free plan too.
  assert.equal(backend.entitlements.planId(), 'free');
  assert.equal(backend.entitlements.can('templates.pro'), false);

  await refreshPlan();
  assert.equal(currentPlanId, FREE_PLAN_ID);

  const proTemplate = { id: 'tpl-pro', tier: 'pro' };
  const freeTemplate = { id: 'tpl-free', tier: 'free' };

  // Free plan: pro template gated, free template accessible.
  assert.equal(canAccessTemplate(entitlements, USER, freeTemplate), true);
  assert.equal(canAccessTemplate(entitlements, USER, proTemplate), false);
  assert.throws(() => entitlements.assertCan('templates.pro'), /pro/i);

  // Switch to pro via the real mock checkout → unlocks immediately.
  const session = await billing.checkout(USER, PRO_PLAN_ID);
  assert.equal(session.status, 'completed');
  await refreshPlan();
  assert.equal(currentPlanId, PRO_PLAN_ID);
  assert.equal(canAccessTemplate(entitlements, USER, proTemplate), true);
  assert.equal(entitlements.can('templates.pro'), true);
  assert.doesNotThrow(() => entitlements.assertCan('publish.vercel'));

  // Cancel back to free → gated again.
  await billing.cancel(USER);
  await refreshPlan();
  assert.equal(currentPlanId, FREE_PLAN_ID);
  assert.equal(canAccessTemplate(entitlements, USER, proTemplate), false);
});

test('(j) telemetry is default-OFF on the offline facade; opt-in records', () => {
  const backend = createOfflineBackend();
  const telemetry = backend.telemetry;

  assert.equal(telemetry.stats().enabled, false, 'telemetry default OFF');
  telemetry.track('builder.test');
  assert.equal(telemetry.stats().recorded, 0, 'nothing recorded while disabled');

  telemetry.setEnabled(true);
  telemetry.track('builder.test', { projectId: 'p1' });
  assert.equal(telemetry.stats().recorded, 1);

  telemetry.setEnabled(false);
  telemetry.track('builder.test');
  assert.equal(telemetry.stats().recorded, 1, 'disabling stops recording again');
});
