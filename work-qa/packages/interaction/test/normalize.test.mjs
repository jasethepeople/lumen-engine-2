import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InputNormalizer,
  createVelocityTracker,
  estimateVelocity,
  makeEvent,
  normalizeDelta,
  normalizePosition,
} from '../dist/index.js';

test('normalizePosition maps to 0..1 and clamps', () => {
  assert.deepEqual(normalizePosition(500, 250, [1000, 500]), [0.5, 0.5]);
  assert.deepEqual(normalizePosition(2000, -10, [1000, 500]), [1, 0]);
  assert.deepEqual(normalizePosition(10, 10, [0, 0]), [0, 0]); // degenerate viewport
});

test('normalizeDelta divides by viewport', () => {
  assert.deepEqual(normalizeDelta(100, 50, [1000, 500]), [0.1, 0.1]);
});

test('estimateVelocity is per-second; zero dt is safe', () => {
  assert.deepEqual(estimateVelocity([0.1, 0], 100), [1, 0]);
  assert.deepEqual(estimateVelocity([0.1, 0], 0), [0, 0]);
});

test('velocity tracker smooths across samples', () => {
  const t = createVelocityTracker();
  assert.deepEqual(t.push([0, 0], 0), [0, 0]); // first sample has no velocity
  const v1 = t.push([0.1, 0], 100); // raw 1 unit/s, smoothed
  assert.ok(v1[0] > 0 && v1[0] < 1);
  const v2 = t.push([0.2, 0], 200);
  assert.ok(v2[0] > v1[0]); // converging toward raw velocity
  t.reset();
  assert.deepEqual(t.push([0.5, 0.5], 500), [0, 0]);
});

test('makeEvent produces an immutable-shaped NormalizedInputEvent', () => {
  const e = makeEvent('scroll', 42, [0.5, 0.5], [0, 0.01], [0, 0.5], { shift: true, ctrl: false, alt: false });
  assert.equal(e.source, 'scroll');
  assert.equal(e.timestamp, 42);
  assert.deepEqual(e.delta, [0, 0.01]);
  assert.equal(e.modifiers.shift, true);
});

test('InputNormalizer.attach is a guarded no-op without a DOM', () => {
  const n = new InputNormalizer();
  n.attach({}); // must not throw in Node
  n.detach();
});
