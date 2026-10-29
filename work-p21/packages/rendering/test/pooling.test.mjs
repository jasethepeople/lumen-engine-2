import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ElementPool, intersectsViewport, clampDprScale, RenderingError } from '../dist/index.js';

test('pool acquire creates once and reuses bindings', () => {
  const pool = new ElementPool(() => ({}));
  const a1 = pool.acquire('a');
  assert.equal(a1.reused, false);
  assert.equal(pool.created, 1);
  const a2 = pool.acquire('a');
  assert.equal(a2.reused, true);
  assert.equal(a2.el, a1.el);
  assert.equal(pool.created, 1);
});

test('retain frees removed ids and recycles their elements', () => {
  const pool = new ElementPool(() => ({}));
  const a = pool.acquire('a').el;
  const b = pool.acquire('b').el;
  pool.retain(new Set(['b']));
  assert.equal(pool.activeCount, 1);
  assert.equal(pool.freeCount, 1);
  const c = pool.acquire('c');
  assert.equal(c.reused, true);
  assert.equal(c.el, a); // freelist element recycled for a new id
  assert.equal(pool.reused, 1);
  assert.equal(pool.created, 2);
  assert.notEqual(c.el, b);
});

test('retain with empty keep-set frees everything', () => {
  const pool = new ElementPool(() => ({}));
  pool.acquire('x');
  pool.acquire('y');
  pool.retain(new Set());
  assert.equal(pool.activeCount, 0);
  assert.equal(pool.freeCount, 2);
});

test('reset hook runs on release', () => {
  const reset = [];
  const pool = new ElementPool(() => ({}), (el) => reset.push(el));
  const el = pool.acquire('x').el;
  pool.retain(new Set());
  assert.deepEqual(reset, [el]);
});

test('viewport intersection culling math', () => {
  const vw = 100;
  const vh = 100;
  assert.equal(intersectsViewport({ x: 0, y: 0, width: 50, height: 50 }, vw, vh), true);
  assert.equal(intersectsViewport({ x: 90, y: 90, width: 50, height: 50 }, vw, vh), true); // partially visible
  assert.equal(intersectsViewport({ x: -49, y: 0, width: 50, height: 50 }, vw, vh), true); // 1px sliver visible
  assert.equal(intersectsViewport({ x: 100, y: 0, width: 10, height: 10 }, vw, vh), false); // fully right
  assert.equal(intersectsViewport({ x: 0, y: -60, width: 10, height: 50 }, vw, vh), false); // fully above
  assert.equal(intersectsViewport({ x: 0, y: 0, width: 0, height: 50 }, vw, vh), false); // degenerate
});

test('clampDprScale enforces the 0.5..2.0 contract range', () => {
  assert.equal(clampDprScale(0.1), 0.5);
  assert.equal(clampDprScale(1), 1);
  assert.equal(clampDprScale(3), 2);
});

test('Canvas2DRenderer.createTarget validates dimensions (headless guard order)', async () => {
  const { Canvas2DRenderer } = await import('../dist/index.js');
  const r = new Canvas2DRenderer();
  assert.throws(() => r.createTarget({ width: 0, height: 10 }), (err) => {
    return err instanceof RenderingError && err.code === 'INVALID_TARGET';
  });
});

test('renderFrame before init throws typed error', async () => {
  const { Canvas2DRenderer } = await import('../dist/index.js');
  const r = new Canvas2DRenderer();
  const s = { cpuMs: 0, gpuMsEstimate: 0, drawCalls: 0, overBudget: false };
  assert.throws(
    () => r.renderFrame({ time: 0, camera: cam(), drawList: [], post: [], clearColor: [0, 0, 0, 1] }, s),
    (err) => err instanceof RenderingError && err.code === 'RENDERER_NOT_INITIALIZED',
  );
});

const cam = () => ({ position: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0], fov: 60, near: 0.1, far: 100 });
