import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQualityController } from '../dist/index.js';

const stats = (ms, overBudget = false) => ({ cpuMs: ms, gpuMsEstimate: ms, drawCalls: 1, overBudget });

test('starts at highest allowed rung', () => {
  const c = new AdaptiveQualityController({ budgetMs: 16.7 });
  assert.equal(c.getLevel().dprScale, 2.0);
  assert.equal(c.getLevel().msaa, 8);
});

test('steps down under sustained over-budget frames, respecting cooldown', () => {
  const c = new AdaptiveQualityController({ budgetMs: 16.7, cooldownMs: 500, emaAlpha: 1 });
  // First over-budget frame cannot step: cooldown measured from t=0.
  assert.equal(c.update(stats(40), 0), false);
  assert.equal(c.update(stats(40), 400), false); // still inside cooldown
  assert.equal(c.update(stats(40), 500), true); // cooldown elapsed -> step down
  const before = c.getLevel().dprScale;
  assert.equal(c.update(stats(40), 700), false); // cooldown again blocks
  assert.equal(c.getLevel().dprScale, before);
  assert.equal(c.update(stats(40), 1100), true);
  assert.ok(c.getLevel().dprScale < before);
});

test('hysteresis: hovering between up and down thresholds does not oscillate', () => {
  const c = new AdaptiveQualityController({ budgetMs: 16.7, cooldownMs: 0, upStreakRequired: 2, emaAlpha: 1 });
  // Force one step down.
  assert.equal(c.update(stats(60, true), 0), true);
  const rungAfterDown = c.rung;
  // Feed frames between upThreshold*0.7 and downThreshold*1.0 (e.g. 14ms of 16.7 budget).
  for (let t = 100; t <= 3000; t += 100) {
    assert.equal(c.update(stats(14), t), false);
  }
  assert.equal(c.rung, rungAfterDown);
});

test('steps back up only after a sustained headroom streak', () => {
  const c = new AdaptiveQualityController({ budgetMs: 16.7, cooldownMs: 100, upStreakRequired: 3, emaAlpha: 1 });
  assert.equal(c.update(stats(60, true), 1000), true); // step down
  const low = c.rung;
  assert.equal(c.update(stats(2), 1100), false); // streak 1
  assert.equal(c.update(stats(2), 1200), false); // streak 2
  assert.equal(c.rung, low); // streak not complete
  assert.equal(c.update(stats(2), 1300), true); // streak hits 3, cooldown elapsed
  assert.equal(c.rung, low + 1);
});

test('never steps below the minimum rung', () => {
  const c = new AdaptiveQualityController({ budgetMs: 16.7, cooldownMs: 0 });
  for (let t = 0; t <= 10000; t += 100) c.update(stats(200, true), t);
  const level = c.getLevel();
  assert.equal(level.dprScale, 0.5);
  assert.equal(level.msaa, 0);
  assert.deepEqual(level.postPasses, []);
});

test('dpr cap from the capability envelope limits the top rung', () => {
  const c = new AdaptiveQualityController({ budgetMs: 16.7 }, [], );
  assert.equal(c.getLevel().dprScale, 2.0);
  const capped = new AdaptiveQualityController({ budgetMs: 16.7, maxDpr: 1.0 });
  assert.equal(capped.getLevel().dprScale, 1.0);
});

test('post passes shed on low rungs and restore on high rungs', () => {
  const c = new AdaptiveQualityController({ budgetMs: 16.7, cooldownMs: 0 }, ['bloom', 'grain']);
  assert.deepEqual(c.getLevel().postPasses, ['bloom', 'grain']);
  for (let t = 0; t <= 10000; t += 100) c.update(stats(200, true), t);
  assert.deepEqual(c.getLevel().postPasses, []);
});

test('ema tracks frame time', () => {
  const c = new AdaptiveQualityController({ budgetMs: 16.7 });
  assert.equal(c.emaFrameMs, null);
  c.update(stats(10), 0);
  assert.equal(c.emaFrameMs, 10);
  c.update(stats(20), 100);
  assert.ok(Math.abs(c.emaFrameMs - 12) < 1e-9); // 0.2*20 + 0.8*10
});
