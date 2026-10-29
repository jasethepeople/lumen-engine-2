/**
 * Regression: DomRenderer must compose translate + scale into ONE CSS
 * transform string (`translate3d(...) scale(...)`), never overwrite the
 * translation with the scale (or vice versa). Runs against compiled dists
 * with a minimal fake DOM: `node --test test/dom-transform.test.mjs`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

// --- Minimal fake DOM (install before importing the renderer). -------------
function makeEl() {
  const el = {
    style: {},
    dataset: {},
    children: [],
    parentElement: null,
    innerHTML: '',
    appendChild(c) {
      c.parentElement = el;
      el.children.push(c);
    },
    removeChild(c) {
      el.children = el.children.filter((x) => x !== c);
      c.parentElement = null;
    },
    remove() {
      el.parentElement?.removeChild(el);
    },
  };
  return el;
}
globalThis.document = {
  createElement: () => makeEl(),
  body: makeEl(),
};
globalThis.HTMLElement = class FakeHTMLElement {};

const { DomRenderer, drawCallForNode } = await import('../dist/index.js');

const surface = { width: 800, height: 600 };

function domCall(x, y, scale, layer = 1) {
  const node = {
    id: 'n1',
    kind: 'dom',
    transform: { position: [x, y, 0], rotationQuat: [0, 0, 0, 1], scale: [scale, scale, 1] },
    layer,
    visible: true,
    bindings: [],
    children: [],
    payload: { html: '<p>hi</p>' },
  };
  const world = { position: [x, y, 0], rotationQuat: [0, 0, 0, 1], scale: [scale, scale, 1] };
  return drawCallForNode(node, world, surface);
}

function frame(drawList) {
  return { time: 0, camera: {}, drawList, post: [], clearColor: [0, 0, 0, 1] };
}

test('frame adapter emits scale() as the CSS transform for scaled dom nodes', () => {
  const call = domCall(10, 20, 1.25);
  assert.equal(call.payload.transform, 'scale(1.25, 1.25)');
  assert.deepEqual(call.payload.rect, { x: 10, y: 20, width: 790, height: 580 });
});

test('DomRenderer composes translate3d + scale in a single transform string', async () => {
  const renderer = new DomRenderer();
  await renderer.init({}); // fake surface: not an HTMLElement, falls back to document.body
  renderer.resize(800, 600, 1);

  const stats = { cpuMs: 0, gpuMsEstimate: 0, drawCalls: 0, overBudget: false };
  renderer.renderFrame(frame([domCall(10, 20, 1.25)]), stats);

  const root = document.body.children[0];
  const el = root.children[0];
  assert.equal(
    el.style.transform,
    'translate3d(10px, 20px, 0) scale(1.25, 1.25)',
    'translation and scale composed, not overwritten',
  );

  // Re-render with a moved rect: the scale term must survive the update.
  renderer.renderFrame(frame([domCall(30, 40, 1.25)]), stats);
  assert.equal(el.style.transform, 'translate3d(30px, 40px, 0) scale(1.25, 1.25)');

  // Identity scale: no scale term at all (unchanged historical behavior).
  renderer.renderFrame(frame([domCall(5, 6, 1)]), stats);
  assert.equal(el.style.transform, 'translate3d(5px, 6px, 0)');

  renderer.dispose();
});

// --- P11: DOM layer richness ------------------------------------------------
function rotatedCall(angleZ, layer = 1, payloadExtra = {}) {
  const q = [0, 0, Math.sin(angleZ / 2), Math.cos(angleZ / 2)];
  const node = {
    id: 'nr',
    kind: 'dom',
    transform: { position: [0, 0, 0], rotationQuat: q, scale: [1, 1, 1] },
    layer,
    visible: true,
    bindings: [],
    children: [],
    payload: { html: '<p>r</p>', ...payloadExtra },
  };
  const world = { position: [0, 0, 0], rotationQuat: q, scale: [1, 1, 1] };
  return drawCallForNode(node, world, surface);
}

test('identity quat keeps the legacy scale() string (bit-for-bit)', () => {
  const call = domCall(0, 0, 2);
  assert.equal(call.payload.transform, 'scale(2, 2)');
  assert.equal(call.payload.layerGroup, undefined);
});

test('non-identity rotationQuat emits matrix3d with cos/sin terms', () => {
  const angle = Math.PI / 4;
  const call = rotatedCall(angle);
  const t = call.payload.transform;
  assert.ok(t.startsWith('matrix3d('), `expected matrix3d, got ${t}`);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Rotation-z matrix: m0=cos, m1=sin (column-major), within rounding.
  const nums = t.slice('matrix3d('.length, -1).split(',').map((s) => Number(s.trim()));
  assert.equal(nums.length, 16);
  assert.ok(Math.abs(nums[0] - cos) < 1e-6);
  assert.ok(Math.abs(nums[1] - sin) < 1e-6);
  assert.ok(Math.abs(nums[4] + sin) < 1e-6);
  assert.ok(Math.abs(nums[5] - cos) < 1e-6);
});

test('explicit payload rect is preferred over the surface-derived rect', () => {
  const rect = { x: 5, y: 6, width: 100, height: 50 };
  const call = rotatedCall(0, 1, { rect });
  assert.deepEqual(call.payload.rect, rect);
  // Absent rect: legacy derivation unchanged.
  const legacy = rotatedCall(0);
  assert.deepEqual(legacy.payload.rect, { x: 0, y: 0, width: 800, height: 600 });
});

test('grouped payloads parent to a stacking-context group div', async () => {
  const renderer = new DomRenderer();
  await renderer.init({});
  renderer.resize(800, 600, 1);
  const stats = { cpuMs: 0, gpuMsEstimate: 0, drawCalls: 0, overBudget: false };

  const groupedA = rotatedCall(0, 20, { layerGroup: 'hero' });
  groupedA.nodeId = 'a';
  const groupedB = rotatedCall(0, 5, { layerGroup: 'hero' });
  groupedB.nodeId = 'b';
  const plain = domCall(1, 1, 1, 10);
  plain.nodeId = 'c';

  renderer.renderFrame(frame([groupedA, groupedB, plain]), stats);

  const root = document.body.children[0];
  const group = root.children.find((c) => c.dataset?.layerGroup === 'hero');
  assert.ok(group, 'group div created');
  assert.equal(group.style.zIndex, '5', 'group z-index = min layer of the group');
  assert.equal(group.children.length, 2, 'both grouped elements parented to the group');
  const ungrouped = root.children.find((c) => c.dataset?.layerGroup === undefined && c.innerHTML === '<p>hi</p>');
  assert.ok(ungrouped, 'ungrouped element still appended to root');
  assert.equal(ungrouped.style.zIndex, '10');
  renderer.dispose();
});
