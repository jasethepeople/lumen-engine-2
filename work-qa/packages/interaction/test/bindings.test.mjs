import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BindingRuntime,
  isStaticFallback,
  mapInputToOutput,
  snapValue,
  stepValues,
} from '../dist/index.js';

const binding = (over = {}) => ({
  id: 'b1',
  source: 'scroll',
  targetNodeId: 'node-1',
  targetTrackId: 'track-1',
  mapping: { inputRange: [0, 1], outputRange: [0, 10], ...over.mapping },
  a11yFallback: 'steps',
  ...over,
});

test('mapInputToOutput: linear, clamped, inverted ranges', () => {
  assert.equal(mapInputToOutput(0.5, [0, 1], [0, 10]), 5);
  assert.equal(mapInputToOutput(2, [0, 1], [0, 10]), 10); // clamp
  assert.equal(mapInputToOutput(-1, [0, 1], [0, 10]), 0);
  assert.equal(mapInputToOutput(0.25, [0, 1], [10, 0]), 7.5); // inverted output
  assert.equal(mapInputToOutput(5, [5, 5], [1, 2]), 1); // degenerate input
});

test('snapValue snaps within threshold only', () => {
  assert.equal(snapValue(1.9, [0, 2, 4], 0.2), 2);
  assert.equal(snapValue(1.0, [0, 2, 4], 0.2), 1.0);
});

test('isStaticFallback', () => {
  assert.equal(isStaticFallback('static'), true);
  assert.equal(isStaticFallback('native-video'), true);
  assert.equal(isStaticFallback('steps'), false);
});

test('binding runtime maps input to output without smoothing', () => {
  const r = new BindingRuntime(binding({ a11yFallback: 'steps' }));
  r.feedInput(0.5);
  const out = r.update(1 / 60, false);
  assert.equal(out, 5);
  r.feedInput(2);
  assert.equal(r.update(1 / 60, false), 10);
});

test('lerp smoothing converges over frames', () => {
  const r = new BindingRuntime(
    binding({ mapping: { inputRange: [0, 1], outputRange: [0, 10], smoothing: { type: 'lerp', factor: 0.2 } } }),
  );
  r.feedInput(1);
  let out = r.update(1 / 60, false);
  assert.ok(out < 10 && out > 0);
  for (let i = 0; i < 300; i++) out = r.update(1 / 60, false);
  assert.ok(Math.abs(out - 10) < 1e-3);
});

test('spring smoothing converges', () => {
  const r = new BindingRuntime(
    binding({ mapping: { inputRange: [0, 1], outputRange: [0, 10], smoothing: { type: 'spring', factor: 0.3 } } }),
  );
  r.feedInput(0.5);
  let out = 0;
  for (let i = 0; i < 600; i++) out = r.update(1 / 60, false);
  assert.ok(Math.abs(out - 5) < 1e-2, `got ${out}`);
});

test('snap points in mapping pull output to nearest point', () => {
  const r = new BindingRuntime(
    binding({ mapping: { inputRange: [0, 1], outputRange: [0, 1], snap: [0, 0.5, 1] } }),
  );
  r.feedInput(0.51);
  assert.equal(r.update(1 / 60, false), 0.5);
});

test('static fallback pins output at outputRange[0]', () => {
  const r = new BindingRuntime(binding({ a11yFallback: 'static' }));
  r.feedInput(0.9);
  assert.equal(r.update(1 / 60, false), 0);
});

test('native-video fallback deactivates binding', () => {
  const r = new BindingRuntime(binding({ a11yFallback: 'native-video' }));
  r.feedInput(0.9);
  assert.equal(r.update(1 / 60, false), 0);
});

test('steps fallback quantizes under reduced motion', () => {
  const r = new BindingRuntime(
    binding({ mapping: { inputRange: [0, 1], outputRange: [0, 10], snap: [0, 5, 10] } }),
  );
  r.feedInput(0.44);
  assert.equal(r.update(1 / 60, true), 5); // quantized to nearest step instantly
});

test('keyboard step navigation walks discrete values', () => {
  const b = binding({ mapping: { inputRange: [0, 1], outputRange: [0, 10], snap: [2, 8] } });
  assert.deepEqual(stepValues(b), [0, 2, 8, 10]);
  const r = new BindingRuntime(b);
  assert.equal(r.stepNext(), 2);
  assert.equal(r.stepNext(), 8);
  assert.equal(r.stepNext(), 10);
  assert.equal(r.stepNext(), 10); // clamped at end
  assert.equal(r.stepPrev(), 8);
});
