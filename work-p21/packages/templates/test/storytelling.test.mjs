import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storytellingTemplate } from '../dist/index.js';
import { makeConfig, makeManifest, scene, assertComposedSceneValid } from './fixtures.mjs';

test('storytelling gives every block enter/progress/exit scroll tracks', () => {
  const cfg = makeConfig('storytelling', [
    scene('b-1', 'block', [{ id: 't1', kind: 'dom', html: '<p>intro</p>' }], 'scroll', 4),
    scene('b-2', 'media', [{ id: 'v1', kind: 'video-plane', assetId: 'hero-video' }], 'scroll', 6),
    scene('b-3', 'sticky-media', [{ id: 's1', kind: 'mesh', assetId: 'product-model' }], 'scroll', 8),
  ]);
  const out = storytellingTemplate.compose(cfg, makeManifest());
  assertComposedSceneValid(out);
  assert.equal(out.tracks.length, 9, '3 blocks x 3 tracks');

  for (const t of out.tracks) assert.equal(t.driver, 'scroll');

  const sticky = out.sceneGraph.find((n) => n.meta.storytelling.sticky);
  assert.ok(sticky, 'sticky media slot marked');
  assert.deepEqual(sticky.meta.storytelling.scrollRange, [10, 18]);

  const progress = out.tracks.find((t) => t.id === 'track-b-2-progress');
  assert.deepEqual(progress.range, [4, 10]);
});
