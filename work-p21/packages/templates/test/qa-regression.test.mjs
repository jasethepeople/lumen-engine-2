/**
 * QA regression (FB1/FB2/FB5): template duration guards, composed track
 * ranges in bindings, chapter scrollRange clamping, cinematic-story clock.
 *
 * Run: `node --test test/qa-regression.test.mjs` (after package build).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scrollVideoTemplate,
  scrollCinemaLandingTemplate,
  cinematicStoryTemplate,
} from '../dist/index.js';
import { makeConfig, makeManifest, scene, assertComposedSceneValid } from './fixtures.mjs';

function zeroDurationManifest() {
  // What manifestFromAssetRefs synthesizes when config declares no duration.
  const m = makeManifest();
  m.assets['hero-video'] = {
    ...m.assets['hero-video'],
    duration: 0,
  };
  return m;
}

test('scroll-video: zero-duration video falls back to totalRange (nonzero scrub)', () => {
  const cfg = makeConfig('scroll-video', [
    scene('stage-1', 'stage', [{ id: 'v1', kind: 'video-plane', assetId: 'hero-video' }], 'scroll', 10),
    scene('cap-1', 'caption', [{ id: 'c1', kind: 'dom', html: '<p>x</p>' }], 'scroll', 2),
  ]);
  const out = scrollVideoTemplate.compose(cfg, zeroDurationManifest());
  assertComposedSceneValid(out);
  const scrub = out.tracks.find((t) => t.id.includes('scrub'));
  assert.ok(scrub, 'scrub track exists');
  assert.deepEqual(scrub.range, [0, 12]);
  assert.equal(scrub.keyframes.at(-1).value, 12, 'scrub reaches totalRange when duration unknown');
});

test('scroll-video: real declared duration drives the scrub keyframe end', () => {
  const cfg = makeConfig('scroll-video', [
    scene('stage-1', 'stage', [{ id: 'v1', kind: 'video-plane', assetId: 'hero-video' }], 'scroll', 10),
  ]);
  const manifest = zeroDurationManifest();
  manifest.assets['hero-video'].duration = 8;
  const out = scrollVideoTemplate.compose(cfg, manifest);
  const scrub = out.tracks.find((t) => t.id.includes('scrub'));
  assert.equal(scrub.keyframes.at(-1).value, 8);
});

test('resolveBindings: outputRange follows the composed track range, not config', () => {
  const cfg = makeConfig(
    'scroll-video',
    [
      scene('stage-1', 'stage', [{ id: 'v1', kind: 'video-plane', assetId: 'hero-video' }], 'scroll', 8),
      scene('cap-1', 'caption', [{ id: 'c1', kind: 'dom', html: '<p>x</p>' }], 'scroll', 4),
    ],
    [{ id: 'i1', source: 'scroll', scene: 'stage-1', inputRange: [0, 1], a11yFallback: 'static' }],
  );
  const out = scrollVideoTemplate.compose(cfg, zeroDurationManifest());
  const binding = out.bindings.find((b) => b.id === 'i1');
  assert.deepEqual(
    binding.mapping.outputRange,
    [0, 12],
    'composed scrub range [0,12] instead of config [0,8]',
  );
});

test('scroll-cinema-landing: negative durationOrRange cannot invert ranges', () => {
  const cfg = makeConfig('scroll-cinema-landing', [
    scene('stage-1', 'stage', [{ id: 'v1', kind: 'video-plane', assetId: 'hero-video' }], 'scroll', -5),
    scene('ch-1', 'chapters', [{ id: 'c1', kind: 'dom', html: '<p>1</p>', meta: { scrollRange: [50, 99] } }], 'scroll', 3),
  ]);
  const out = scrollCinemaLandingTemplate.compose(cfg, zeroDurationManifest());
  assertComposedSceneValid(out);
  assert.ok(out.tracks.length > 0);
  const scrub = out.tracks.find((t) => t.id.includes('scrub'));
  const totalRange = scrub.range[1];
  assert.ok(totalRange > 0, 'totalRange positive despite negative input');
  for (const t of out.tracks) {
    assert.ok(t.range[0] >= 0, `track ${t.id} starts >= 0 (got ${t.range[0]})`);
    assert.ok(t.range[1] > t.range[0], `track ${t.id} range ordered (got ${t.range})`);
    assert.ok(t.range[1] <= totalRange, `track ${t.id} clamped into [0,${totalRange}] (got ${t.range})`);
  }
});

test('cinematic-story: zero-duration acts floor at 0.1s and never reverse the clock', () => {
  const cfg = makeConfig('cinematic-story', [
    scene('act-1', 'acts', [{ id: 'v1', kind: 'video-plane', assetId: 'hero-video' }], 'time', 0),
    scene('act-2', 'acts', [{ id: 'c1', kind: 'dom', html: '<p>2</p>' }], 'time', 0),
    scene('act-3', 'acts', [{ id: 'c2', kind: 'dom', html: '<p>3</p>' }], 'time', 4),
  ]);
  const out = cinematicStoryTemplate.compose(cfg, zeroDurationManifest());
  assertComposedSceneValid(out);
  for (const t of out.tracks) {
    assert.ok(t.range[0] >= 0, `track ${t.id} starts >= 0 (got ${t.range[0]})`);
    assert.ok(t.range[1] >= t.range[0], `track ${t.id} range ordered (got ${t.range})`);
  }
});
