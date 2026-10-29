import assert from 'node:assert/strict';
import test from 'node:test';

import { GestureRecognizer, createDoubleTapDetector } from '../dist/index.js';

const sample = (phase, x, y, timestamp, pointerId = 1) => ({
  source: 'pointer',
  timestamp,
  position: [x, y],
  delta: [0, 0],
  velocity: [0, 0],
  modifiers: { shift: false, ctrl: false, alt: false },
  phase,
  pointerId,
});

const collect = (rec) => {
  const events = [];
  rec.onGesture = (e) => events.push(e);
  return events;
};

test('tap: quick press-release emits a tap', () => {
  const rec = new GestureRecognizer();
  const events = collect(rec);
  rec.feed(sample('start', 0.5, 0.5, 0));
  rec.feed(sample('end', 0.5, 0.5, 100));
  const taps = events.filter((e) => e.type === 'tap');
  assert.equal(taps.length, 1);
  assert.deepEqual(taps[0].position, [0.5, 0.5]);
});

test('tap rejected when press moves too far', () => {
  const rec = new GestureRecognizer();
  const events = collect(rec);
  rec.feed(sample('start', 0.5, 0.5, 0));
  rec.feed(sample('move', 0.6, 0.5, 50)); // > tapMaxDistance
  rec.feed(sample('end', 0.6, 0.5, 100));
  assert.equal(events.filter((e) => e.type === 'tap').length, 0);
});

test('double-tap detected by helper', () => {
  const rec = new GestureRecognizer();
  const events = collect(rec);
  const dbl = createDoubleTapDetector(300, 0.04);
  const tap = (t) => {
    rec.feed(sample('start', 0.5, 0.5, t));
    rec.feed(sample('end', 0.5, 0.5, t + 50));
  };
  tap(0);
  tap(150);
  const taps = events.filter((e) => e.type === 'tap');
  assert.equal(taps.length, 3); // tap, tap, tap (double emits an extra)
  assert.equal(dbl.isDoubleTap(taps[0].position, 50), false);
  assert.equal(dbl.isDoubleTap(taps[1].position, 200), true);
});

test('pan: start/update/end sequence after threshold', () => {
  const rec = new GestureRecognizer();
  const events = collect(rec);
  rec.feed(sample('start', 0.1, 0.5, 0));
  rec.feed(sample('move', 0.2, 0.5, 50)); // crosses panMinDistance
  rec.feed(sample('move', 0.3, 0.5, 100));
  rec.feed(sample('end', 0.3, 0.5, 150));
  const pans = events.filter((e) => e.type === 'pan');
  assert.deepEqual(pans.map((e) => e.state), ['start', 'update', 'end']);
  assert.ok(pans[0].delta[0] > 0);
});

test('swipe: fast pan end emits swipe with dominant direction', () => {
  const rec = new GestureRecognizer();
  const events = collect(rec);
  rec.feed(sample('start', 0.1, 0.5, 0));
  rec.feed(sample('move', 0.3, 0.5, 50));
  const fast = sample('end', 0.4, 0.5, 80);
  fast.velocity = [2.5, 0.1]; // > swipeMinVelocity
  // ensure the tracked pointer's last velocity is high: send fast move first
  rec.feed({ ...sample('move', 0.4, 0.5, 80), velocity: [2.5, 0.1] });
  rec.feed(fast);
  const swipes = events.filter((e) => e.type === 'swipe');
  assert.equal(swipes.length, 1);
  assert.deepEqual(swipes[0].direction, [1, 0]);
});

test('pinch: two-pointer scale emits start/update/end with scale', () => {
  const rec = new GestureRecognizer();
  const events = collect(rec);
  rec.feed(sample('start', 0.4, 0.5, 0, 1));
  rec.feed(sample('start', 0.6, 0.5, 10, 2)); // distance 0.2
  rec.feed(sample('move', 0.7, 0.5, 30, 2)); // distance 0.3 → scale 1.5
  rec.feed(sample('move', 0.8, 0.5, 60, 2)); // distance 0.4 → scale 2
  rec.feed(sample('end', 0.8, 0.5, 90, 2));
  rec.feed(sample('end', 0.4, 0.5, 95, 1));
  const pinches = events.filter((e) => e.type === 'pinch');
  assert.deepEqual(pinches.map((e) => e.state), ['start', 'update', 'end']);
  assert.ok(Math.abs(pinches[0].scale - 1.5) < 1e-6);
  assert.ok(Math.abs(pinches[1].scale - 2) < 1e-6);
});

test('pinch cancels pending tap', () => {
  const rec = new GestureRecognizer();
  const events = collect(rec);
  rec.feed(sample('start', 0.4, 0.5, 0, 1));
  rec.feed(sample('start', 0.6, 0.5, 10, 2));
  rec.feed(sample('move', 0.8, 0.5, 30, 2));
  rec.feed(sample('end', 0.8, 0.5, 40, 2));
  rec.feed(sample('end', 0.4, 0.5, 45, 1));
  assert.equal(events.filter((e) => e.type === 'tap').length, 0);
});

test('long-press fires after hold threshold', async () => {
  const rec = new GestureRecognizer({ longPressDuration: 20 });
  const events = collect(rec);
  rec.feed(sample('start', 0.5, 0.5, 0));
  await new Promise((r) => setTimeout(r, 40));
  rec.feed(sample('end', 0.5, 0.5, 40));
  const lps = events.filter((e) => e.type === 'longpress');
  assert.deepEqual(lps.map((e) => e.state), ['start', 'end']);
});

test('long-press cancelled by movement', async () => {
  const rec = new GestureRecognizer({ longPressDuration: 20 });
  const events = collect(rec);
  rec.feed(sample('start', 0.5, 0.5, 0));
  rec.feed(sample('move', 0.56, 0.5, 10));
  await new Promise((r) => setTimeout(r, 40));
  rec.feed(sample('end', 0.56, 0.5, 40));
  assert.equal(events.filter((e) => e.type === 'longpress').length, 0);
});

test('reset clears in-progress state', () => {
  const rec = new GestureRecognizer();
  const events = collect(rec);
  rec.feed(sample('start', 0.1, 0.5, 0));
  rec.feed(sample('move', 0.3, 0.5, 50));
  rec.reset();
  rec.feed(sample('end', 0.3, 0.5, 100));
  assert.equal(events.filter((e) => e.type === 'pan').length, 1); // only 'start'
});
