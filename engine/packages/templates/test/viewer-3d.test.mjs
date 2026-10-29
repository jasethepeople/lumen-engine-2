import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewer3dTemplate, VIEWER_3D_CAMERA_DEFAULTS } from '../dist/index.js';
import { makeConfig, makeManifest, scene, assertComposedSceneValid } from './fixtures.mjs';

test('viewer-3d composes model node, camera defaults, and orbit track', () => {
  const cfg = makeConfig('viewer-3d', [
    scene('m-1', 'model', [{ id: 'mm', kind: 'mesh', assetId: 'product-model' }], 'pointer', 1),
    scene('h-1', 'hotspot', [{ id: 'hs', kind: 'dom', html: '<button>info</button>' }], 'time', 2),
  ]);
  const out = viewer3dTemplate.compose(cfg, makeManifest());
  assertComposedSceneValid(out);

  const camera = out.sceneGraph.find((n) => n.kind === 'camera');
  assert.deepEqual(camera.transform.position, VIEWER_3D_CAMERA_DEFAULTS.position);
  assert.equal(camera.meta['viewer-3d'].fov, 45);

  const model = out.sceneGraph.find((n) => n.kind === 'mesh');
  assert.equal(model.payload.assetId, 'product-model');

  const orbit = out.tracks.find((t) => t.driver === 'pointer');
  assert.ok(orbit, 'pointer orbit track present');
  assert.equal(orbit.target, model.id);
  assert.deepEqual(orbit.range, [0, Math.PI * 2]);
});

test('viewer-3d maps pointer gestures onto the orbit track', () => {
  const cfg = makeConfig(
    'viewer-3d',
    [scene('m-1', 'model', [{ id: 'mm', kind: 'mesh', assetId: 'product-model' }], 'pointer', 1)],
    [{ id: 'drag', source: 'pointer', gesture: 'pan', scene: 'm-1', inputRange: [0, 600] }],
  );
  const out = viewer3dTemplate.compose(cfg, makeManifest());
  assert.equal(out.bindings.length, 1);
  assert.equal(out.bindings[0].gesture, 'pan');
  const orbit = out.tracks.find((t) => t.driver === 'pointer');
  assert.equal(out.bindings[0].targetTrackId, orbit.id);
});
