import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQualityController, buildLadder, LADDER_V1 } from '../dist/index.js';

const stats = (ms, overBudget = false) => ({ cpuMs: ms, gpuMsEstimate: ms, drawCalls: 1, overBudget });

test('starts at highest allowed rung', () => {
  const c = new AdaptiveQualityController({ budgetMs: 16.7 });
  assert.equal(c.getLevel().dprScale, 2.0);
  assert.equal(c.getLevel().msaa, 8);
});

test('steps down under sustained over-budget frames, respecting cooldown', () => {
  // Legacy ladder preset: one step down moves dpr + msaa together (P13 keeps
  // this exact behavior available via `ladder: LADDER_V1`).
  const c = new AdaptiveQualityController({ budgetMs: 16.7, cooldownMs: 500, emaAlpha: 1, ladder: LADDER_V1 });
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

// --- P13: decoupled quality ladder axes -------------------------------------

test('expanded ladder contains LADDER_V1 as a subsequence with identical axes', () => {
  const expanded = buildLadder(LADDER_V1, 2);
  const want = LADDER_V1.map((r) => `${r.dprScale}|${r.msaa}|${r.shadowMapSize}`);
  const got = expanded.map((r) => `${r.dprScale}|${r.msaa}|${r.shadowMapSize}`);
  let i = 0;
  for (const g of got) {
    if (g === want[i]) i += 1;
  }
  assert.equal(i, want.length, 'base rungs appear in order');
  assert.ok(expanded.length > LADDER_V1.length, 'ladder actually expanded');
});

test('consecutive rungs differ in exactly one axis', () => {
  const expanded = buildLadder(LADDER_V1, 3);
  const axis = (r) => [r.dprScale, r.msaa, r.shadowMapSize, Math.min(r.postKeep, 3)];
  for (let i = 1; i < expanded.length; i += 1) {
    const a = axis(expanded[i - 1]);
    const b = axis(expanded[i]);
    const diffs = a.filter((v, k) => v !== b[k]).length;
    assert.equal(diffs, 1, `rungs ${i - 1}→${i} differ in ${diffs} axes: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
});

test('postKeep decreases by exactly one per post rung', () => {
  const expanded = buildLadder(LADDER_V1, 3);
  // Post shedding lives between LADDER_V1 rungs 1 (keep 1) and 2 (keep all),
  // i.e. the dpr-1.0 group: one rung per dropped pass, then the base rung.
  const postRungs = expanded
    .filter((r) => r.dprScale === 1.0 && r.msaa === 2 && r.shadowMapSize === 1024)
    .map((r) => Math.min(r.postKeep, 3));
  assert.deepEqual(postRungs, [1, 2, 3]);
});

test('controller sheds exactly one axis per step under consecutive overruns', () => {
  const c = new AdaptiveQualityController({ budgetMs: 16.7, cooldownMs: 0, emaAlpha: 1 }, ['bloom', 'grain', 'vignette']);
  let prev = c.getLevel();
  assert.deepEqual(prev.postPasses, ['bloom', 'grain', 'vignette']);
  // Step 1 from the top: sheds MSAA only (8 → 4), dpr and post held — the
  // LADDER_V1 top pair shares postKeep, so the first shed axis is MSAA.
  assert.equal(c.update(stats(50), 0), true);
  let cur = c.getLevel();
  assert.equal(cur.msaa, 4);
  assert.equal(cur.dprScale, prev.dprScale);
  assert.deepEqual(cur.postPasses, prev.postPasses);
  // Walk the whole ladder: every single step changes exactly one axis, and
  // post passes shed one at a time somewhere along the way.
  const axis = (l) => [l.dprScale, l.msaa, l.shadowMapSize, l.postPasses.length];
  const postCounts = new Set([cur.postPasses.length]);
  for (let t = 100; t <= 20000; t += 100) {
    if (!c.update(stats(50), t)) continue;
    prev = cur;
    cur = c.getLevel();
    const a = axis(prev);
    const b = axis(cur);
    assert.equal(a.filter((v, k) => v !== b[k]).length, 1, `one axis per step: ${a} → ${b}`);
    postCounts.add(cur.postPasses.length);
  }
  assert.deepEqual([...postCounts].sort(), [0, 1, 2, 3], 'post shed one pass at a time');
  assert.equal(c.rung, 0, 'reached the bottom rung');
});

test('LADDER_V1 preset reproduces legacy rung sequence and getLevel outputs', () => {
  const legacy = new AdaptiveQualityController({ budgetMs: 16.7, cooldownMs: 0, emaAlpha: 1, ladder: LADDER_V1 }, ['bloom', 'grain']);
  const seq = [legacy.getLevel()];
  for (let t = 0; t <= 10000 && seq.length < 6; t += 100) {
    if (legacy.update(stats(50), t)) seq.push(legacy.getLevel());
  }
  assert.deepEqual(
    seq.map((l) => [l.dprScale, l.msaa, l.shadowMapSize]),
    [
      [2.0, 8, 2048],
      [1.5, 4, 2048],
      [1.25, 4, 1024],
      [1.0, 2, 1024],
      [0.75, 0, 512],
      [0.5, 0, 256],
    ],
  );
  // Legacy post shedding: bottom rung sheds all, next keeps one.
  assert.deepEqual(seq[5].postPasses, []);
  assert.deepEqual(seq[4].postPasses, ['bloom']);
  assert.deepEqual(seq[3].postPasses, ['bloom', 'grain']);
});

test('window clamping with maxDpr is unchanged on the expanded ladder', () => {
  const capped = new AdaptiveQualityController({ budgetMs: 16.7, maxDpr: 1.25 });
  assert.equal(capped.getLevel().dprScale, 1.25);
  assert.equal(capped.getLevel().msaa, 4, 'starts at the full-fidelity rung of the capped dpr');
});
