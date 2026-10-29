import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollVideoTemplate } from '../dist/index.js';
import { makeConfig, makeManifest, scene, assertComposedSceneValid } from './fixtures.mjs';

test('scroll-video compose produces a valid scene with scrub track and captions', () => {
  const cfg = makeConfig('scroll-video', [
    scene('stage-1', 'stage', [{ id: 'v1', kind: 'video-plane', assetId: 'hero-video' }], 'scroll', 6),
    scene('cap-1', 'caption', [{ id: 'c1', kind: 'dom', html: '<p>Hello</p>' }], 'scroll', 3),
    scene('cap-2', 'caption', [{ id: 'c2', kind: 'dom', html: '<p>World</p>' }], 'scroll', 3),
  ]);
  const out = scrollVideoTemplate.compose(cfg, makeManifest());
  assertComposedSceneValid(out);

  const video = out.sceneGraph.find((n) => n.kind === 'video-plane');
  assert.ok(video, 'video plane present');
  assert.equal(video.payload.scrubbed, true);
  assert.equal(video.payload.assetId, 'hero-video');

  const scrub = out.tracks.find((t) => t.driver === 'scroll' && t.target === video.id);
  assert.ok(scrub, 'scrub track bound to video');
  assert.deepEqual(scrub.range, [0, 12]);
  assert.equal(scrub.keyframes.at(-1).value, 12, 'scrubs to video duration');

  const captions = out.sceneGraph.filter((n) => n.kind === 'group');
  assert.equal(captions.length, 2);
  assert.equal(out.hydration.ssr, true);
  assert.equal(out.hydration.islands.length, 2);
});

test('scroll-video resolves scroll interactions onto the scrub track', () => {
  const cfg = makeConfig(
    'scroll-video',
    [scene('stage-1', 'stage', [{ id: 'v1', kind: 'video-plane', assetId: 'hero-video' }], 'scroll', 6)],
    [{ id: 'i1', source: 'scroll', scene: 'stage-1', inputRange: [0, 2000], a11yFallback: 'native-video' }],
  );
  const out = scrollVideoTemplate.compose(cfg, makeManifest());
  assert.equal(out.bindings.length, 1);
  assert.equal(out.bindings[0].a11yFallback, 'native-video');
  assert.deepEqual(out.bindings[0].mapping.inputRange, [0, 2000]);
});
