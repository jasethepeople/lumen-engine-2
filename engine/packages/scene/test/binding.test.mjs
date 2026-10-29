import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyBindings, resolvePlayheads, setByPath } from '../dist/binding.js';
import { SceneGraph } from '../dist/graph.js';
import { createSceneRuntime, evaluate } from '../dist/runtime.js';

function node(id, overrides = {}) {
  return {
    id,
    kind: 'mesh',
    transform: { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] },
    layer: 0,
    visible: true,
    bindings: [],
    children: [],
    payload: { assetId: 'a', material: { opacity: 1 } },
    ...overrides,
  };
}

test('setByPath writes nested and indexed paths', () => {
  const n = node('n');
  assert.ok(setByPath(n, 'transform.position.y', 7));
  assert.equal(n.transform.position[1], 7);
  assert.ok(setByPath(n, 'payload.material.opacity', 0.5));
  assert.equal(n.payload.material.opacity, 0.5);
  assert.ok(!setByPath(n, 'nope.deep.path', 1));
});

test('applyBindings writes track values and marks transforms dirty', () => {
  const n = node('hero', {
    bindings: [
      { trackId: 'slide', property: 'transform.position.x' },
      { trackId: 'fade', property: 'material.opacity', easing: 'linear' },
    ],
  });
  const tracks = [
    { id: 'slide', target: 'hero', keyframes: [{ t: 0, value: 0 }, { t: 10, value: 100 }], driver: 'time', range: [0, 10] },
    { id: 'fade', target: 'hero', keyframes: [{ t: 0, value: 1 }, { t: 2, value: 0 }], driver: 'scroll', range: [0, 2] },
  ];
  const g = new SceneGraph([n]);
  g.recomputeAll();
  const playheads = resolvePlayheads(tracks, 5, { scroll: 1 });
  assert.equal(playheads.get('slide'), 5);
  assert.equal(playheads.get('fade'), 1);
  const touched = applyBindings(g, tracks, playheads);
  assert.deepEqual(touched, ['hero']);
  assert.equal(n.transform.position[0], 50);
  assert.equal(n.payload.material.opacity, 0.5);
  assert.equal(g.dirtyCount, 1); // transform write marks node dirty
  assert.equal(g.updateWorldTransforms(), 1);
  assert.equal(g.getWorldTransform('hero').position[0], 50);
});

test('binding easing override applies between keyframes', () => {
  const n = node('hero', { bindings: [{ trackId: 't', property: 'transform.position.x', easing: 'ease-in' }] });
  const tracks = [{ id: 't', target: 'hero', keyframes: [{ t: 0, value: 0 }, { t: 10, value: 100 }], driver: 'time', range: [0, 10] }];
  const g = new SceneGraph([n]);
  applyBindings(g, tracks, resolvePlayheads(tracks, 5));
  assert.ok(Math.abs(n.transform.position[0] - 25) < 1e-9);
});

test('evaluate() is pure and composes graph + bindings', () => {
  const scene = {
    sceneGraph: [node('hero', { bindings: [{ trackId: 'slide', property: 'transform.position.x' }] })],
    tracks: [{ id: 'slide', target: 'hero', keyframes: [{ t: 0, value: 0 }, { t: 10, value: 100 }], driver: 'time', range: [0, 10] }],
    bindings: [],
    hydration: { ssr: false, islands: [] },
  };
  const ws = evaluate(scene, 5);
  assert.equal(ws.byId.get('hero').worldTransform.position[0], 50);
  // Input untouched.
  assert.equal(scene.sceneGraph[0].transform.position[0], 0);

  const hidden = {
    ...scene,
    sceneGraph: [node('p', { visible: false, children: [node('c')] })],
    tracks: [],
  };
  hidden.sceneGraph[0].children = [node('c')];
  const ws2 = evaluate(hidden, 0);
  assert.equal(ws2.byId.get('p').visible, false);
  assert.equal(ws2.byId.get('c').visible, false); // ancestor visibility propagates
});

test('SceneRuntime reuses graph and only recomputes dirty subtrees', () => {
  const scene = {
    sceneGraph: [
      node('mover', { bindings: [{ trackId: 't', property: 'transform.position.x' }] }),
      node('static'),
    ],
    tracks: [{ id: 't', target: 'mover', keyframes: [{ t: 0, value: 0 }, { t: 1, value: 10 }], driver: 'time', range: [0, 1] }],
    bindings: [],
    hydration: { ssr: false, islands: [] },
  };
  const rt = createSceneRuntime(scene);
  const ws1 = rt.evaluateAt(0.5);
  assert.equal(ws1.byId.get('mover').worldTransform.position[0], 5);
  assert.equal(rt.graph.dirtyCount, 0);
  const ws2 = rt.evaluateAt(1);
  assert.equal(ws2.byId.get('mover').worldTransform.position[0], 10);
});

test('scroll-driven track via drivers (driver-agnostic binding)', () => {
  const scene = {
    sceneGraph: [node('scrubber', { bindings: [{ trackId: 's', property: 'transform.position.y' }] })],
    tracks: [{ id: 's', target: 'scrubber', keyframes: [{ t: 0, value: 0 }, { t: 100, value: 200 }], driver: 'scroll', range: [0, 100] }],
    bindings: [],
    hydration: { ssr: false, islands: [] },
  };
  // time is irrelevant for a scroll-driven track.
  const ws = evaluate(scene, 999, { scroll: 50 });
  assert.equal(ws.byId.get('scrubber').worldTransform.position[1], 100);
});
