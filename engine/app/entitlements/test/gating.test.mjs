/**
 * @lumen/app-entitlements — Phase 15 canAccessTemplate gating matrix tests.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntitlementService, canAccessTemplate } from '../dist/index.js';

const freeService = new EntitlementService(() => 'free');
const proService = new EntitlementService(() => 'pro');

const freeTemplate = { id: 'tpl-free', tier: 'free' };
const proTemplate = { id: 'tpl-pro', tier: 'pro' };
const untieredTemplate = { id: 'tpl-plain' };
const owns = () => true;
const ownsNothing = () => false;

test('gating matrix: free plan', () => {
  // Free plan → free templates only.
  assert.equal(canAccessTemplate(freeService, 'u1', freeTemplate), true);
  assert.equal(canAccessTemplate(freeService, 'u1', untieredTemplate), true);
  assert.equal(canAccessTemplate(freeService, 'u1', proTemplate), false);
  // No resolver → purchases cannot grant access.
  assert.equal(canAccessTemplate(freeService, 'u1', proTemplate, ownsNothing), false);
  // Individual purchase overrides on the free tier.
  assert.equal(canAccessTemplate(freeService, 'u1', proTemplate, owns), true);
  // Resolver receives (userId, templateId).
  const scoped = (userId, templateId) => userId === 'u2' && templateId === 'tpl-pro';
  assert.equal(canAccessTemplate(freeService, 'u2', proTemplate, scoped), true);
  assert.equal(canAccessTemplate(freeService, 'u3', proTemplate, scoped), false);
});

test('gating matrix: pro plan', () => {
  // Pro plan → everything, regardless of ownership.
  assert.equal(canAccessTemplate(proService, 'u1', freeTemplate), true);
  assert.equal(canAccessTemplate(proService, 'u1', proTemplate), true);
  assert.equal(canAccessTemplate(proService, 'u1', proTemplate, ownsNothing), true);
});

test('unknown plan ids fall back to free-tier behavior', () => {
  const weird = new EntitlementService(() => 'enterprise');
  assert.equal(canAccessTemplate(weird, 'u1', freeTemplate), true);
  assert.equal(canAccessTemplate(weird, 'u1', proTemplate), false);
  assert.equal(canAccessTemplate(weird, 'u1', proTemplate, owns), true);
});
