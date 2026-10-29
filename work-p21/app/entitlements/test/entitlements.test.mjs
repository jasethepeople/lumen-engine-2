/**
 * @lumen/app-entitlements — unit tests (node --test) against compiled output.
 * Run: npm run build && node --test test/
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ENTITLEMENT_KEYS,
  PLAN_ENTITLEMENTS,
  FREE_PROJECT_LIMIT,
  PRO_PROJECT_LIMIT,
  EntitlementDeniedError,
  EntitlementService,
  isEntitlementDeniedError,
  requiredPlanFor,
} from '../dist/index.js';

const free = () => new EntitlementService(() => 'free');
const pro = () => new EntitlementService(() => 'pro');

test('matrix: free holds only basic export; pro holds everything', () => {
  const f = free();
  assert.equal(f.can('export.static'), true);
  for (const key of ENTITLEMENT_KEYS) {
    if (key !== 'export.static') assert.equal(f.can(key), false, `free should lack ${key}`);
  }
  const p = pro();
  for (const key of ENTITLEMENT_KEYS) {
    assert.equal(p.can(key), true, `pro should hold ${key}`);
  }
  // Matrix constant itself: pro is a superset of free.
  for (const key of PLAN_ENTITLEMENTS.free) {
    assert.ok(PLAN_ENTITLEMENTS.pro.has(key));
  }
});

test('unknown plan ids degrade to free', () => {
  const svc = new EntitlementService(() => 'enterprise');
  assert.equal(svc.planId(), 'free');
  assert.equal(svc.can('templates.pro'), false);
  assert.equal(svc.projectLimit(), FREE_PROJECT_LIMIT);
});

test('assertCan: no-op when granted, throws shaped error when denied', () => {
  assert.doesNotThrow(() => pro().assertCan('publish.vercel'));
  assert.doesNotThrow(() => free().assertCan('export.static'));

  try {
    free().assertCan('export.custom-domain');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(isEntitlementDeniedError(err));
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'EntitlementDeniedError');
    assert.equal(err.key, 'export.custom-domain');
    assert.equal(err.requiredPlan, 'pro');
    assert.match(err.message, /export\.custom-domain/);
    assert.match(err.message, /pro/);
  }
});

test('requiredPlanFor: free-granted keys report free, others pro', () => {
  assert.equal(requiredPlanFor('export.static'), 'free');
  assert.equal(requiredPlanFor('templates.pro'), 'pro');
});

test('projectLimit: 3 free, Infinity pro', () => {
  assert.equal(free().projectLimit(), 3);
  assert.equal(pro().projectLimit(), Number.POSITIVE_INFINITY);
  assert.equal(PRO_PROJECT_LIMIT, Number.POSITIVE_INFINITY);
});

test('gateTemplate: free tier open to all, pro tier gated', () => {
  assert.equal(free().gateTemplate({ id: 'a', tier: 'free' }), true);
  assert.equal(free().gateTemplate({ id: 'b' }), true); // untiered = free
  assert.equal(pro().gateTemplate({ id: 'c', tier: 'pro' }), true);

  assert.throws(
    () => free().gateTemplate({ id: 'c', tier: 'pro' }),
    (err) =>
      isEntitlementDeniedError(err) &&
      err.key === 'templates.pro' &&
      err.requiredPlan === 'pro',
  );
});

test('gateExport: static for everyone, custom-domain pro only', () => {
  assert.equal(free().gateExport('static'), true);
  assert.equal(pro().gateExport('custom-domain'), true);
  assert.throws(
    () => free().gateExport('custom-domain'),
    (err) =>
      isEntitlementDeniedError(err) &&
      err.key === 'export.custom-domain' &&
      err.requiredPlan === 'pro',
  );
});

test('grantedKeys reflects the current plan', () => {
  assert.deepEqual(free().grantedKeys(), ['export.static']);
  assert.equal(pro().grantedKeys().length, ENTITLEMENT_KEYS.length);
});

test('resolver is consulted per call (plan upgrades take effect live)', () => {
  let plan = 'free';
  const svc = new EntitlementService(() => plan);
  assert.equal(svc.can('templates.pro'), false);
  plan = 'pro';
  assert.equal(svc.can('templates.pro'), true);
});

test('EntitlementDeniedError is a proper Error subclass', () => {
  const err = new EntitlementDeniedError('publish.vercel', 'pro');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof EntitlementDeniedError);
  assert.equal(err.key, 'publish.vercel');
  assert.equal(err.requiredPlan, 'pro');
});
