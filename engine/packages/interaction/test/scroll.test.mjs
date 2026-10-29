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

// ---------- P1: MotionPolicy-driven scroller ----------

// Minimal structural MotionPolicy double (shape matches @lumen/contracts).
function makePolicy(mode) {
  return {
    mode,
    advanceTime: (e, dt) => (mode === 'static' ? 0 : e + dt),
    interpolate: (cur, target, alpha) =>
      mode === 'continuous' ? cur + (target - cur) * alpha : target,
    quantizeScrub: (s, bs) => {
      if (mode === 'continuous') return s;
      if (mode === 'static') return 0;
      let best = bs[0] ?? 0;
      for (const b of bs) if (Math.abs(s - b) < Math.abs(s - best)) best = b;
      return best;
    },
    trackMode: (t) => t.motion ?? mode,
  };
}

test('P1: policy-driven scroller equals legacy reduced-motion scroller output', () => {
  const legacy = new LumenVirtualScroller({ reducedMotion: true });
  const policyDriven = new LumenVirtualScroller({ motion: makePolicy('reveal') });
  for (const d of [0.2, 0.15, -0.05, 0.3]) {
    legacy.feedDelta(d);
    policyDriven.feedDelta(d);
    legacy.update(FRAME);
    policyDriven.update(FRAME);
    assert.equal(policyDriven.progress, legacy.progress);
    assert.equal(policyDriven.targetProgress, legacy.targetProgress);
  }
});

test('P1: continuous policy keeps smoothing (byte-identical to no policy)', () => {
  const plain = new LumenVirtualScroller({ smoothing: 0.2 });
  const withPolicy = new LumenVirtualScroller({ smoothing: 0.2, motion: makePolicy('continuous') });
  plain.feedDelta(0.5);
  withPolicy.feedDelta(0.5);
  for (let i = 0; i < 10; i++) {
    assert.equal(withPolicy.update(FRAME), plain.update(FRAME));
  }
});

test('P1: reveal policy steps progress to snap boundaries', () => {
  const s = new LumenVirtualScroller({ snap: [0, 0.5, 1], motion: makePolicy('reveal') });
  s.feedDelta(0.4);
  s.update(FRAME);
  assert.equal(s.progress, 0.5); // quantized to nearest boundary
  s.feedDelta(0.4);
  s.update(FRAME);
  assert.equal(s.progress, 1);
});

test('P1: policy supersedes the raw boolean', () => {
  // reducedMotion=false but policy reveal → jumps instantly.
  const s = new LumenVirtualScroller({ reducedMotion: false, motion: makePolicy('static') });
  s.feedDelta(0.5);
  assert.equal(s.progress, 0.5);
});

// --- P9: unified scroll input + restoration ---------------------------------

test('native-path write equals delta-path write for the same logical input', () => {
  const viaDelta = new LumenVirtualScroller({ smoothing: 0.2 });
  viaDelta.feedDelta(0.4); // wheelMultiplier 1 → target 0.4
  const viaNative = new LumenVirtualScroller({ smoothing: 0.2 });
  viaNative.setTargetFromNormalized(0.4);
  assert.equal(viaNative.targetProgress, viaDelta.targetProgress);
  for (let i = 0; i < 200; i++) {
    viaDelta.update(FRAME);
    viaNative.update(FRAME);
  }
  assert.equal(viaNative.progress, viaDelta.progress);
});

test('attach() onScroll routes through the same normalized write seam', () => {
  const prevWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  try {
    const s = new LumenVirtualScroller({ smoothing: 0.2 });
    let scrollHandler;
    const el = {
      scrollTop: 250,
      scrollHeight: 1000,
      clientHeight: 500, // max = 500 → p = 0.5
      addEventListener: (_type, fn) => { scrollHandler = fn; },
      removeEventListener() {},
    };
    s.attach(el);
    scrollHandler();
    assert.equal(s.targetProgress, 0.5);
    const ref = new LumenVirtualScroller({ smoothing: 0.2 });
    ref.feedDelta(0.5);
    for (let i = 0; i < 200; i++) { s.update(FRAME); ref.update(FRAME); }
    assert.equal(s.progress, ref.progress);
    s.detach();
  } finally {
    globalThis.window = prevWindow;
  }
});

test('reduced-motion jump parity between absolute and delta writes', () => {
  const a = new LumenVirtualScroller({ reducedMotion: true });
  a.setTargetFromNormalized(0.7);
  const b = new LumenVirtualScroller({ reducedMotion: true });
  b.feedDelta(0.7);
  assert.equal(a.progress, b.progress);
  a.setTargetFromNormalized(2); // clamped
  assert.equal(a.progress, 1);
});

function withFakeHistory(fn) {
  const prevWindow = globalThis.window;
  const prevHistory = globalThis.history;
  const writes = [];
  const listeners = {};
  globalThis.window = {
    addEventListener: (t, fn2) => { listeners[t] = fn2; },
    removeEventListener: (t) => { delete listeners[t]; },
  };
  globalThis.history = {
    state: null,
    replaceState: (state) => { writes.push(state); globalThis.history.state = state; },
  };
  try {
    fn({ writes, listeners });
  } finally {
    globalThis.window = prevWindow;
    globalThis.history = prevHistory;
  }
}

test('restoration round-trip: settle writes state; popstate restores progress', () => {
  withFakeHistory(({ writes, listeners }) => {
    const s = new LumenVirtualScroller({ smoothing: 0.5, restorationKey: 'home' });
    s.feedDelta(0.6);
    for (let i = 0; i < 100; i++) s.update(FRAME);
    assert.ok(writes.length >= 1, 'settle persisted state');
    assert.equal(writes.at(-1).lumenScroll.home, 0.6);

    // Navigate away, then simulate browser-back.
    s.setTargetFromNormalized(0.1);
    for (let i = 0; i < 100; i++) s.update(FRAME);
    listeners.popstate({ state: { lumenScroll: { home: 0.6 } } });
    assert.equal(s.targetProgress, 0.6);
    let published;
    const s2 = new LumenVirtualScroller({
      smoothing: 0.5,
      restorationKey: 'home',
      onProgress: (p) => { published = p; },
    });
    void s2;
    for (let i = 0; i < 100; i++) s.update(FRAME);
    assert.equal(s.progress, 0.6);
    s.detach();
    assert.equal(listeners.popstate, undefined, 'popstate listener removed on detach');
  });
});

test('restoration writes are throttled to one per 500 ms', () => {
  withFakeHistory(({ writes }) => {
    const s = new LumenVirtualScroller({ smoothing: 0.9, restorationKey: 'k' });
    for (let n = 0; n < 5; n += 1) {
      s.setTargetFromNormalized(0.1 * (n + 1));
      s.update(FRAME); // converges within one frame at smoothing 0.9? no — settle needs |t-c|<1e-4
      for (let i = 0; i < 60; i++) s.update(FRAME);
    }
    assert.ok(writes.length <= 1, `expected ≤1 write, got ${writes.length}`);
  });
});

test('no history global ⇒ restoration is a no-op (no throw)', () => {
  const s = new LumenVirtualScroller({ smoothing: 0.5, restorationKey: 'k' });
  s.feedDelta(0.5);
  for (let i = 0; i < 100; i++) s.update(FRAME);
  assert.equal(s.progress, 0.5);
});
