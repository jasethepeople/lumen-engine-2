/**
 * QA regression (FB1): scroll-scrub routing.
 *
 * Run against compiled dists: `node --test test/scrub.test.mjs`
 * (after `bash scripts/build-all.sh`).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectScrubTargets, createScrubber } from '../dist/scrub.js';
import { manifestFromAssetRefs } from '../dist/index.js';

function fakeScene() {
  return {
    graph: {
      roots: [
        {
          id: 'node-stage-video',
          kind: 'video-plane',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          layer: 0,
          visible: true,
          bindings: [{ trackId: 'track-stage-scrub', property: 'playback.time' }],
          payload: { assetId: 'hero-video', scrubbed: true },
          children: [
            {
              id: 'nested',
              kind: 'video-plane',
              transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
              layer: 0,
              visible: true,
              bindings: [],
              payload: { assetId: 'other', scrubbed: true },
              children: [],
            },
          ],
        },
        {
          id: 'caption',
          kind: 'dom',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          layer: 1,
          visible: true,
          bindings: [{ trackId: 't2', property: 'opacity' }],
          payload: { html: '<p>hi</p>' },
          children: [],
        },
      ],
    },
  };
}

function fakeAssets(video) {
  return { get: (id) => (id === 'hero-video' ? { kind: 'video', video } : undefined) };
}

test('collectScrubTargets finds bound scrubbed video-plane nodes only', () => {
  const targets = collectScrubTargets(fakeScene());
  assert.deepEqual(targets, [
    { nodeId: 'node-stage-video', assetId: 'hero-video', trackId: 'track-stage-scrub' },
  ]);
});

test('createScrubber routes playhead values to seekTo, throttled', () => {
  const seeks = [];
  const video = { seekTo: async (t) => { seeks.push(t); } };
  let clock = 0;
  const errors = [];
  const scrubber = createScrubber({
    assets: fakeAssets(video),
    onError: (e) => errors.push(e),
    now: () => clock,
    minIntervalMs: 100,
    epsilon: 0.01,
  });
  const targets = collectScrubTargets(fakeScene());
  const playheads = new Map([['track-stage-scrub', 2.5]]);

  scrubber.update(playheads, targets); // seeks (first value)
  assert.deepEqual(seeks, [2.5]);

  clock += 10;
  playheads.set('track-stage-scrub', 2.55);
  scrubber.update(playheads, targets); // within min interval -> skipped
  assert.deepEqual(seeks, [2.5]);

  clock += 200;
  playheads.set('track-stage-scrub', 2.501);
  scrubber.update(playheads, targets); // interval passed but delta < epsilon
  assert.deepEqual(seeks, [2.5]);

  clock += 200;
  playheads.set('track-stage-scrub', 4.0);
  scrubber.update(playheads, targets); // seeks
  assert.deepEqual(seeks, [2.5, 4.0]);

  // Non-finite / negative values are ignored.
  clock += 500;
  playheads.set('track-stage-scrub', Number.NaN);
  scrubber.update(playheads, targets);
  playheads.set('track-stage-scrub', -1);
  scrubber.update(playheads, targets);
  assert.deepEqual(seeks, [2.5, 4.0]);
  assert.equal(errors.length, 0);
});

test('seek failures surface as engine:error, never throw into the frame loop', async () => {
  const video = { seekTo: async () => { throw new Error('decoder stalled'); } };
  const errors = [];
  const scrubber = createScrubber({
    assets: fakeAssets(video),
    onError: (e) => errors.push(e),
    minIntervalMs: 0,
    epsilon: 0,
  });
  const targets = collectScrubTargets(fakeScene());
  scrubber.update(new Map([['track-stage-scrub', 1]]), targets);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'SCRUB_SEEK_FAILED');
  assert.equal(errors[0].recoverable, true);
});

test('manifestFromAssetRefs: non-finite/<=0 durations collapse to unknown (0)', () => {
  const m = manifestFromAssetRefs([
    { id: 'a', src: 'a.mp4', kind: 'video', duration: 8 },
    { id: 'b', src: 'b.mp4', kind: 'video', duration: 0 },
    { id: 'c', src: 'c.mp4', kind: 'video', duration: Number.NaN },
    { id: 'd', src: 'd.mp4', kind: 'video' },
  ]);
  assert.equal(m.assets['a'].duration, 8);
  assert.equal(m.assets['b'].duration, 0);
  assert.equal(m.assets['c'].duration, 0);
  assert.equal(m.assets['d'].duration, 0);
});
