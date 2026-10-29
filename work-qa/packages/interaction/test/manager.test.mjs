import assert from 'node:assert/strict';
import test from 'node:test';

import { InteractionManager } from '../dist/index.js';

const scrollBinding = (over = {}) => ({
  id: 'scroll-1',
  source: 'scroll',
  targetNodeId: 'node-hero',
  targetTrackId: 'track-hero',
  mapping: { inputRange: [0, 1], outputRange: [0, 12] },
  a11yFallback: 'steps',
  ...over,
});

test('update() produces driver map keyed by track id', () => {
  const m = new InteractionManager({
    bindings: [scrollBinding()],
    reducedMotion: true,
  });
  m.scroller.feedDelta(0.5);
  const drivers = m.update(1 / 60);
  assert.deepEqual(Object.keys(drivers), ['track-hero']);
  assert.equal(drivers['track-hero'], 6); // 0.5 * 12
  assert.deepEqual(m.drivers, drivers);
});

test('multiple bindings produce independent driver entries', () => {
  const m = new InteractionManager({
    reducedMotion: false,
    bindings: [
      scrollBinding(),
      scrollBinding({ id: 'scroll-2', targetNodeId: 'n2', targetTrackId: 'track-2', mapping: { inputRange: [0, 1], outputRange: [0, 4] } }),
    ],
  });
  m.scroller.feedDelta(0.25);
  let d;
  for (let i = 0; i < 300; i++) d = m.update(1 / 60);
  assert.ok(Math.abs(d['track-hero'] - 3) < 1e-3);
  assert.ok(Math.abs(d['track-2'] - 1) < 1e-3);
});

test('gesture binding driven by pan input', () => {
  const m = new InteractionManager({
    reducedMotion: false,
    bindings: [
      {
        id: 'g1',
        source: 'pointer',
        gesture: 'pan',
        targetNodeId: 'n',
        targetTrackId: 'track-pan',
        mapping: { inputRange: [0, 1], outputRange: [0, 5] },
        a11yFallback: 'steps',
      },
    ],
  });
  const ev = (phase, x, y, t) => ({
    source: 'pointer',
    timestamp: t,
    position: [x, y],
    delta: [0, 0],
    velocity: [0, 0],
    modifiers: { shift: false, ctrl: false, alt: false },
    phase,
    pointerId: 1,
  });
  m.gestures.feed(ev('start', 0.1, 0.1, 0));
  const fast = ev('move', 0.2, 0.1, 50);
  fast.velocity = [2, 0];
  m.gestures.feed(fast);
  m.update(1 / 60);
  const fast2 = ev('move', 0.6, 0.1, 100);
  fast2.velocity = [2, 0];
  m.gestures.feed(fast2);
  const d = m.update(1 / 60);
  assert.ok(d['track-pan'] > 0, `expected positive driver, got ${d['track-pan']}`);
  assert.ok(d['track-pan'] <= 5);
});

test('update() with no bindings returns empty map', () => {
  const m = new InteractionManager({ reducedMotion: true });
  assert.deepEqual(m.update(1 / 60), {});
});

test('unregisterBinding removes driver output', () => {
  const m = new InteractionManager({ bindings: [scrollBinding()], reducedMotion: true });
  m.unregisterBinding('scroll-1');
  assert.deepEqual(m.update(1 / 60), {});
});

test('static fallback binding stays pinned via manager', () => {
  const m = new InteractionManager({
    reducedMotion: true,
    bindings: [scrollBinding({ a11yFallback: 'static' })],
  });
  m.scroller.feedDelta(0.9);
  assert.equal(m.update(1 / 60)['track-hero'], 0);
});
