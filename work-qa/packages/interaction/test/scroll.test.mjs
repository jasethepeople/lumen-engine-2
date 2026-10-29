import assert from 'node:assert/strict';
import test from 'node:test';

import { LumenVirtualScroller } from '../dist/index.js';

const FRAME = 1 / 60;

test('lerp converges to target', () => {
  const s = new LumenVirtualScroller({ smoothing: 0.2 });
  s.feedDelta(0.5);
  for (let i = 0; i < 200; i++) s.update(FRAME);
  assert.ok(Math.abs(s.progress - 0.5) < 1e-6);
  assert.equal(s.progress, s.targetProgress);
});

test('progress is clamped to 0..1', () => {
  const s = new LumenVirtualScroller({ reducedMotion: true });
  s.feedDelta(5);
  assert.equal(s.progress, 1);
  s.feedDelta(-10);
  assert.equal(s.progress, 0);
});

test('wheel multiplier scales raw deltas', () => {
  const s = new LumenVirtualScroller({ wheelMultiplier: 2, reducedMotion: true });
  s.feedDelta(0.1);
  assert.equal(s.progress, 0.2);
});

test('reduced motion mode is instant', () => {
  const s = new LumenVirtualScroller({ smoothing: 0.05 });
  s.setReducedMotion(true);
  s.feedDelta(0.7);
  assert.equal(s.progress, 0.7); // no update() needed
});

test('snapping settles on nearest snap point', () => {
  const s = new LumenVirtualScroller({ smoothing: 0.3, snap: [0, 0.25, 0.5, 0.75, 1] });
  s.feedDelta(0.26);
  for (let i = 0; i < 300; i++) s.update(FRAME);
  assert.equal(s.progress, 0.25);
});

test('no snapping when far from snap points', () => {
  const s = new LumenVirtualScroller({ smoothing: 0.3, snap: [0, 0.5, 1], snapThreshold: 0.01 });
  s.feedDelta(0.35);
  for (let i = 0; i < 300; i++) s.update(FRAME);
  assert.ok(Math.abs(s.progress - 0.35) < 1e-3);
});

test('seek without animate jumps; with animate lerps', () => {
  const s = new LumenVirtualScroller({ smoothing: 0.2 });
  s.seek(0.8, { animate: false });
  assert.equal(s.progress, 0.8);

  const s2 = new LumenVirtualScroller({ smoothing: 0.2 });
  s2.seek(0.8); // animate by default
  assert.equal(s2.progress, 0);
  for (let i = 0; i < 200; i++) s2.update(FRAME);
  assert.ok(Math.abs(s2.progress - 0.8) < 1e-6);
});

test('disabled scroller ignores input', () => {
  const s = new LumenVirtualScroller({ reducedMotion: true });
  s.setEnabled(false);
  s.feedDelta(0.5);
  assert.equal(s.progress, 0);
  s.setEnabled(true);
  s.feedDelta(0.5);
  assert.equal(s.progress, 0.5);
});

test('frame-rate independence: many small steps ≈ few large steps', () => {
  const run = (dt, steps) => {
    const s = new LumenVirtualScroller({ smoothing: 0.12 });
    s.feedDelta(0.6);
    for (let i = 0; i < steps; i++) s.update(dt);
    return s.progress;
  };
  const a = run(FRAME, 60);
  const b = run(FRAME / 2, 120);
  assert.ok(Math.abs(a - b) < 1e-3, `${a} vs ${b}`);
});

test('onProgress fires only when progress changes', () => {
  const values = [];
  const s = new LumenVirtualScroller({ smoothing: 0.2, onProgress: (p) => values.push(p) });
  s.update(FRAME); // no input → no callback
  assert.equal(values.length, 0);
  s.feedDelta(0.4);
  s.update(FRAME);
  assert.equal(values.length, 1);
  for (let i = 0; i < 300; i++) s.update(FRAME);
  assert.ok(Math.abs(values.at(-1) - 0.4) < 1e-6);
});
