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

// ---------- P15: per-track driver smoothing ----------

const FRAME = 1 / 60;

function smoothManager(smoothing) {
  return new InteractionManager({
    bindings: [scrollBinding()],
    reducedMotion: false,
    trackSmoothing: { 'track-hero': smoothing },
  });
}

test('P15: mode none snaps (raw value passes through)', () => {
  const m = smoothManager({ mode: 'none' });
  m.scroller.feedDelta(0.5);
  m.update(FRAME);
  // Scroller itself smooths; per-track 'none' must not add more lag: the
  // driver equals the scroller progress mapped to output range.
  const drivers = m.update(FRAME);
  assert.equal(drivers['track-hero'], m.scroller.progress * 12);
});

test('P15: lerp smoothing lags behind the raw driver', () => {
  const m = smoothManager({ mode: 'lerp', stiffness: 0.1 });
  m.scroller.feedDelta(1);
  // Let the scroller converge fully first.
  for (let i = 0; i < 400; i++) m.update(FRAME);
  m.scroller.seek(0, { animate: false });
  const d1 = m.update(FRAME)['track-hero'];
  assert.ok(d1 > 0 && d1 < 12, `expected partial lerp, got ${d1}`);
  for (let i = 0; i < 400; i++) m.update(FRAME);
  assert.ok(Math.abs(m.update(FRAME)['track-hero']) < 1e-3);
});

test('P15: spring converges frame-rate-independently (60 vs 120 Hz)', () => {
  const run = (hz) => {
    const m = smoothManager({ mode: 'spring', stiffness: 0.1, damping: 0.85 });
    m.scroller.seek(1, { animate: false });
    const dt = 1 / hz;
    for (let i = 0; i < hz * 2; i++) m.update(dt); // 2 simulated seconds
    return m.update(dt)['track-hero'];
  };
  const at60 = run(60);
  const at120 = run(120);
  assert.ok(Math.abs(at60 - 12) < 0.5, `60Hz did not converge: ${at60}`);
  assert.ok(Math.abs(at120 - 12) < 0.5, `120Hz did not converge: ${at120}`);
  assert.ok(Math.abs(at60 - at120) < 0.5, `frame-rate dependent: ${at60} vs ${at120}`);
});

test('P15: motion policy forces mode none under reveal', () => {
  const policy = {
    mode: 'reveal',
    advanceTime: (e, dt) => e + dt,
    interpolate: (_c, t) => t,
    quantizeScrub: (s) => s,
    trackMode: () => 'reveal',
  };
  const m = new InteractionManager({
    bindings: [scrollBinding()],
    motion: policy,
    trackSmoothing: { 'track-hero': { mode: 'spring' } },
  });
  m.scroller.seek(1, { animate: false });
  const drivers = m.update(FRAME);
  assert.equal(drivers['track-hero'], m.scroller.progress * 12); // snap, no spring lag
});

test('P9: restored scroll progress appears in update() DriverMap', () => {
  const prevWindow = globalThis.window;
  const prevHistory = globalThis.history;
  const listeners = {};
  globalThis.window = {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    removeEventListener: () => {},
  };
  globalThis.history = { state: null, replaceState() {} };
  try {
    const m = new InteractionManager({
      bindings: [scrollBinding()],
      reducedMotion: true,
      scroller: { restorationKey: 'page' },
    });
    listeners.popstate({ state: { lumenScroll: { page: 0.5 } } });
    const drivers = m.update(1 / 60);
    assert.equal(drivers['track-hero'], 6, 'restored 0.5 progress drives the track (0.5 * 12)');
    m.dispose?.();
  } finally {
    globalThis.window = prevWindow;
    globalThis.history = prevHistory;
  }
});
