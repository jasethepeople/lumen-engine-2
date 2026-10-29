/**
 * P5 — camera tracks drive RenderFrame.camera.
 * Run against compiled dist: `node --test test/camera.test.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSceneRuntime, applyBindings, resolvePlayheads } from '@lumen/scene';
import { findFirstCameraNodeId, resolveCamera } from '../dist/index.js';

const DEFAULT_CAMERA = {
  position: [0, 0, 5],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fov: 50,
  near: 0.1,
  far: 100,
};

const tf = (position = [0, 0, 0]) => ({
  position,
  rotationQuat: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

const camNode = (over = {}) => ({
  id: 'cam-1',
  kind: 'camera',
  transform: tf(),
  layer: 0,
  visible: true,
  bindings: [{ trackId: 'trk-cam', property: 'transform.position' }],
  children: [],
  ...over,
});

const camTrack = {
  id: 'trk-cam',
  target: 'cam-1',
  driver: 'time',
  range: [0, 2],
  keyframes: [
    { t: 0, value: [0, 0, 5] },
    { t: 2, value: [10, 4, 5] },
  ],
};

function makeScene(nodeOverrides, tracks = [camTrack]) {
  return createSceneRuntime({
    sceneGraph: [camNode(nodeOverrides)],
    tracks,
    bindings: [],
    hydration: { ssr: false, islands: [] },
  });
}

test('no camera node ⇒ DEFAULT_CAMERA identity (same values)', () => {
  const scene = createSceneRuntime({
    sceneGraph: [{ ...camNode(), id: 'g', kind: 'group', bindings: [] }],
    tracks: [],
    bindings: [],
    hydration: { ssr: false, islands: [] },
  });
  const id = findFirstCameraNodeId(scene.graph.roots);
  assert.equal(id, undefined);
  const cam = resolveCamera({ world: undefined, node: undefined, defaultCamera: DEFAULT_CAMERA });
  assert.equal(cam, DEFAULT_CAMERA); // identical reference → byte-identical frames
});

test('camera node with position binding drives the frame camera', () => {
  const scene = makeScene();
  const id = findFirstCameraNodeId(scene.graph.roots);
  assert.equal(id, 'cam-1');
  const node = scene.graph.find(id);
  for (const [playhead, expected] of [
    [0, [0, 0, 5]],
    [1, [5, 2, 5]],
    [2, [10, 4, 5]],
  ]) {
    const playheads = resolvePlayheads(scene.tracks, playhead, {});
    applyBindings(scene.graph, scene.tracks, playheads);
    scene.graph.updateWorldTransforms();
    const cam = resolveCamera({
      world: scene.graph.getWorldTransform(id),
      node,
      defaultCamera: DEFAULT_CAMERA,
    });
    assert.deepEqual(cam.position, expected);
    // identity quat ⇒ target = position + forward(-Z)
    assert.deepEqual(cam.target, [expected[0], expected[1], expected[2] - 1]);
    assert.equal(cam.fov, DEFAULT_CAMERA.fov);
  }
});

test('meta.lookAt overrides the quat-forward target', () => {
  const scene = makeScene({ meta: { lookAt: [1, 2, 3] } });
  const id = findFirstCameraNodeId(scene.graph.roots);
  const cam = resolveCamera({
    world: { position: [4, 5, 6], rotationQuat: [0, 0, 0, 1] },
    node: scene.graph.find(id),
    defaultCamera: DEFAULT_CAMERA,
  });
  assert.deepEqual(cam.target, [1, 2, 3]);
  assert.deepEqual(cam.position, [4, 5, 6]);
});

test('quat-rotated camera targets position + rotated forward', () => {
  // 180° yaw around Y ⇒ forward becomes +Z.
  const scene = makeScene();
  const node = scene.graph.find('cam-1');
  const cam = resolveCamera({
    world: { position: [0, 0, 5], rotationQuat: [0, 1, 0, 0] },
    node,
    defaultCamera: DEFAULT_CAMERA,
  });
  assert.ok(Math.abs(cam.target[2] - 6) < 1e-9);
  assert.ok(Math.abs(cam.target[0]) < 1e-9);
});

test('two camera nodes ⇒ first DFS wins and lookup is cached', () => {
  const second = camNode({ id: 'cam-2', bindings: [] });
  const scene = createSceneRuntime({
    sceneGraph: [camNode({ bindings: [] }), second],
    tracks: [],
    bindings: [],
    hydration: { ssr: false, islands: [] },
  });
  // One boot-time traversal; the result is reused for all N frames.
  const id = findFirstCameraNodeId(scene.graph.roots);
  assert.equal(id, 'cam-1');
  for (let i = 0; i < 5; i++) {
    const cam = resolveCamera({
      world: scene.graph.getWorldTransform(id),
      node: scene.graph.find(id),
      defaultCamera: DEFAULT_CAMERA,
    });
    assert.deepEqual(cam.position, [0, 0, 0]);
  }
});
