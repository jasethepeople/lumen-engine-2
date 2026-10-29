/**
 * QA regression (FB3): touch input feeds the virtual scroller.
 *
 * Run: `node --test test/qa-regression.test.mjs` (after package build).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { InteractionManager } from '../dist/index.js';

const scrollBinding = {
  id: 'scroll-1',
  source: 'scroll',
  targetNodeId: 'node-hero',
  targetTrackId: 'track-hero',
  mapping: { inputRange: [0, 1], outputRange: [0, 12] },
  a11yFallback: 'steps',
};

test('touch drag (finger up) advances the virtual scroller like wheel down', () => {
  const m = new InteractionManager({ bindings: [scrollBinding], reducedMotion: true });
  // Simulate the normalizer's touch event: raw finger movement, dy negative
  // (finger moved up) must scroll content down (positive scroller delta).
  m.normalizer.onEvent({
    source: 'touch',
    timestamp: 0,
    position: [0.5, 0.5],
    delta: [0, -0.5],
    velocity: [0, 0],
    modifiers: { shift: false, ctrl: false, alt: false },
  });
  const drivers = m.update(1 / 60);
  assert.equal(drivers['track-hero'], 6, 'touch drag reached the scrub track');
});

test('touch drag (finger down) scrolls back up', () => {
  const m = new InteractionManager({ bindings: [scrollBinding], reducedMotion: false });
  const ev = (dy) => ({
    source: 'touch',
    timestamp: 0,
    position: [0.5, 0.5],
    delta: [0, dy],
    velocity: [0, 0],
    modifiers: { shift: false, ctrl: false, alt: false },
  });
  m.normalizer.onEvent(ev(-1));
  m.normalizer.onEvent(ev(0.25)); // finger down: scroll back up 0.25
  let d;
  for (let i = 0; i < 300; i++) d = m.update(1 / 60);
  assert.ok(Math.abs(d['track-hero'] - 9) < 1e-3); // (1 - 0.25) * 12
});
