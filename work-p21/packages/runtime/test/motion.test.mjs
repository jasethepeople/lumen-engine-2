/**
 * P1 — MotionPolicy: single owner of reduced-motion behavior.
 * Run against compiled dist: `node --test test/motion.test.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMotionPolicy } from '../dist/index.js';

test('continuous default: legacy behavior byte-identical', () => {
  const p = createMotionPolicy({ reducedMotion: false });
  assert.equal(p.mode, 'continuous');
  assert.equal(p.advanceTime(1.5, 0.25), 1.75);
  assert.equal(p.interpolate(0, 10, 0.5), 5);
  assert.equal(p.quantizeScrub(3.3, [0, 2, 4]), 3.3);
});

test('reduced motion without wire fields maps to reveal', () => {
  const p = createMotionPolicy({ reducedMotion: true });
  assert.equal(p.mode, 'reveal');
});

test('reveal advances time but freezes interpolation', () => {
  const p = createMotionPolicy({ reducedMotion: true, sceneDefault: 'reveal' });
  assert.equal(p.advanceTime(2, 0.5), 2.5); // time passes
  assert.equal(p.interpolate(0, 10, 0.5), 10); // crossfades become cuts
});

test('static holds t=0 and jumps instantly', () => {
  const p = createMotionPolicy({ reducedMotion: true, sceneDefault: 'static' });
  assert.equal(p.advanceTime(2, 0.5), 0);
  assert.equal(p.interpolate(3, 10, 0.5), 10);
  assert.equal(p.quantizeScrub(3.3, [1, 2, 4]), 0);
});

test('wire scene default wins over the reducedMotion boolean', () => {
  const p = createMotionPolicy({ reducedMotion: true, sceneDefault: 'continuous' });
  assert.equal(p.mode, 'continuous');
  const q = createMotionPolicy({ reducedMotion: false, sceneDefault: 'reveal' });
  assert.equal(q.mode, 'reveal');
});

test('per-track override beats scene default', () => {
  const p = createMotionPolicy({ reducedMotion: false, sceneDefault: 'continuous' });
  assert.equal(p.trackMode({ id: 't', motion: 'reveal' }), 'reveal');
  assert.equal(p.trackMode({ id: 't' }), 'continuous');
  const r = createMotionPolicy({ reducedMotion: true });
  assert.equal(r.trackMode({ id: 't', motion: 'continuous' }), 'continuous');
  assert.equal(r.trackMode({ id: 't' }), 'reveal');
});

test('quantizeScrub snaps to the nearest boundary under reveal', () => {
  const p = createMotionPolicy({ reducedMotion: true, sceneDefault: 'reveal' });
  assert.equal(p.quantizeScrub(3.3, [0, 2, 4]), 4);
  assert.equal(p.quantizeScrub(2.9, [0, 2, 4]), 2);
  assert.equal(p.quantizeScrub(0.1, []), 0);
});

test('quantizeScrub uses construction boundaries by default', () => {
  const p = createMotionPolicy({ reducedMotion: true, boundaries: [0, 0.5, 1] });
  assert.equal(p.quantizeScrub(0.8), 1);
});

test('policy swap mid-run: a fresh policy takes effect immediately', () => {
  // Simulates a prefers-reduced-motion toggle: the engine rebuilds the
  // policy and the next frame uses it.
  let policy = createMotionPolicy({ reducedMotion: false });
  let elapsed = 0;
  elapsed = policy.advanceTime(elapsed, 1 / 60);
  assert.ok(elapsed > 0);
  policy = createMotionPolicy({ reducedMotion: true, sceneDefault: 'static' });
  elapsed = policy.advanceTime(elapsed, 1 / 60);
  assert.equal(elapsed, 0);
});
