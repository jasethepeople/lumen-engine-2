import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEasing, cubicBezierEase, evaluateTrack, evaluateTrackAtProgress, resolvePlayhead } from '../dist/timeline.js';

const track = (keyframes, overrides = {}) => ({
  id: 'tr',
  target: 'n',
  keyframes,
  driver: 'time',
  range: [0, 10],
  ...overrides,
});

test('named easings behave', () => {
  assert.equal(applyEasing('linear', 0.25), 0.25);
  assert.equal(applyEasing('ease-in', 0.5), 0.25);
  assert.equal(applyEasing('ease-out', 0.5), 0.75);
  assert.ok(Math.abs(applyEasing('ease-in-out', 0.5) - 0.5) < 1e-9);
  assert.equal(applyEasing('step', 0.99), 0);
  assert.equal(applyEasing('step', 1), 1);
});

test('cubic bezier easing approximates known curves', () => {
  // Linear bezier == identity.
  assert.ok(Math.abs(cubicBezierEase([0, 0, 1, 1], 0.37) - 0.37) < 1e-3);
  // ease-in-out-ish CSS ease (0.42, 0, 0.58, 1): midpoint maps to 0.5.
  assert.ok(Math.abs(cubicBezierEase([0.42, 0, 0.58, 1], 0.5) - 0.5) < 1e-3);
  assert.equal(cubicBezierEase([0.42, 0, 0.58, 1], 0), 0);
  assert.equal(cubicBezierEase([0.42, 0, 0.58, 1], 1), 1);
  // Monotonic.
  const e = (t) => cubicBezierEase([0.42, 0, 0.58, 1], t);
  for (let t = 0; t < 1; t += 0.05) assert.ok(e(t) <= e(t + 0.05) + 1e-9);
});

test('scalar keyframe interpolation with easing', () => {
  const tr = track([
    { t: 0, value: 0 },
    { t: 10, value: 100, easing: 'linear' },
  ]);
  assert.equal(evaluateTrack(tr, -5), 0);
  assert.equal(evaluateTrack(tr, 0), 0);
  assert.equal(evaluateTrack(tr, 5), 50);
  assert.equal(evaluateTrack(tr, 10), 100);
  assert.equal(evaluateTrack(tr, 99), 100);

  const eased = track([
    { t: 0, value: 0, easing: 'ease-in' },
    { t: 10, value: 100 },
  ]);
  assert.ok(Math.abs(evaluateTrack(eased, 5) - 25) < 1e-9);
});

test('vector keyframes lerp component-wise; strings are discrete', () => {
  const vec = track([
    { t: 0, value: [0, 0, 0] },
    { t: 4, value: [4, 8, -4] },
  ]);
  assert.deepEqual(evaluateTrack(vec, 2), [2, 4, -2]);

  const str = track([
    { t: 0, value: 'idle' },
    { t: 4, value: 'run' },
  ]);
  assert.equal(evaluateTrack(str, 0), 'idle');
  assert.equal(evaluateTrack(str, 1), 'idle');
  assert.equal(evaluateTrack(str, 4), 'run');
});

test('easing override beats keyframe easing', () => {
  const tr = track([
    { t: 0, value: 0, easing: 'ease-in' },
    { t: 10, value: 100 },
  ]);
  assert.equal(evaluateTrack(tr, 5, { easing: 'linear' }), 50);
});

test('loop modes and clamping', () => {
  assert.equal(resolvePlayhead(12, [0, 10], 'none'), 10);
  assert.equal(resolvePlayhead(-3, [0, 10], 'none'), 0);
  assert.equal(resolvePlayhead(12, [0, 10], 'loop'), 2);
  assert.equal(resolvePlayhead(-1, [0, 10], 'loop'), 9);
  assert.equal(resolvePlayhead(12, [0, 10], 'pingpong'), 8);
  assert.equal(resolvePlayhead(22, [0, 10], 'pingpong'), 2);

  const tr = track([
    { t: 0, value: 0 },
    { t: 10, value: 10 },
  ]);
  assert.ok(Math.abs(evaluateTrack(tr, 12, { loop: 'loop' }) - 2) < 1e-9);
});

test('progress scrubbing maps [0,1] onto range', () => {
  const tr = track(
    [
      { t: 2, value: 0 },
      { t: 6, value: 40 },
    ],
    { range: [2, 6] },
  );
  assert.equal(evaluateTrackAtProgress(tr, 0), 0);
  assert.equal(evaluateTrackAtProgress(tr, 0.5), 20);
  assert.equal(evaluateTrackAtProgress(tr, 1), 40);
});

test('empty track evaluates to undefined', () => {
  assert.equal(evaluateTrack(track([]), 5), undefined);
});
