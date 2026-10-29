import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cinematicSpaTemplate } from '../dist/index.js';
import { makeConfig, makeManifest, scene, assertComposedSceneValid } from './fixtures.mjs';

test('cinematic-spa sequences scenes on a time clock with entrance/exit keyframes', () => {
  const cfg = makeConfig('cinematic-spa', [
    scene('hero-1', 'hero', [{ id: 'h1', kind: 'video-plane', assetId: 'hero-video' }], 'time', 5),
    scene('gal-1', 'gallery', [{ id: 'g1', kind: 'dom', html: '<div>grid</div>' }], 'time', 4),
    scene('out-1', 'outro', [{ id: 'o1', kind: 'dom', html: '<p>fin</p>' }], 'time', 3),
  ]);
  const out = cinematicSpaTemplate.compose(cfg, makeManifest());
  assertComposedSceneValid(out);
  assert.equal(out.sceneGraph.length, 3);

  const [heroT, galT, outT] = out.tracks;
  assert.equal(heroT.driver, 'time');
  assert.deepEqual(heroT.range, [0, 5]);
  assert.deepEqual(galT.range, [5, 9]);
  assert.deepEqual(outT.range, [9, 12]);

  for (const t of out.tracks) {
    assert.equal(t.keyframes.length, 4, 'entrance/exit keyframes');
    assert.equal(t.keyframes[0].value, 0);
    assert.equal(t.keyframes.at(-1).value, 0);
  }
});

test('cinematic-spa flags missing assets in node meta', () => {
  const cfg = makeConfig('cinematic-spa', [
    scene('hero-1', 'hero', [{ id: 'm1', kind: 'mesh', assetId: 'nope' }], 'time', 2),
  ]);
  const out = cinematicSpaTemplate.compose(cfg, makeManifest());
  const mesh = out.sceneGraph[0].children[0];
  assert.equal(mesh.meta['cinematic-spa'].missingAsset, true);
});
