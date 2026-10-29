import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRenderer, createRenderer, FALLBACK_CHAIN, RenderingError, DomRenderer, Canvas2DRenderer } from '../dist/index.js';

const profile = (over = {}) => ({
  webgl2: false,
  webgpu: false,
  offscreenCanvas: false,
  codecs: { h264: 'unknown', hevc: 'unknown', av1: 'unknown', vp9: 'unknown' },
  maxTextureSize: 4096,
  deviceMemoryGB: null,
  reducedMotion: false,
  dpr: { min: 1, max: 2, current: 1 },
  ...over,
});

test('selectRenderer picks highest supported fidelity', () => {
  assert.equal(selectRenderer(profile({ webgpu: true, webgl2: true })), 'webgpu');
  assert.equal(selectRenderer(profile({ webgl2: true })), 'webgl2');
  assert.equal(selectRenderer(profile()), 'canvas2d');
});

test('selectRenderer honors supported preference', () => {
  assert.equal(selectRenderer(profile({ webgl2: true }), 'dom'), 'dom');
  assert.equal(selectRenderer(profile({ webgpu: true }), 'webgpu'), 'webgpu');
});

test('selectRenderer falls below an unsupported preference', () => {
  // Prefers webgpu but lacks it; should fall to webgl2, not jump the chain.
  assert.equal(selectRenderer(profile({ webgl2: true }), 'webgpu'), 'webgl2');
  assert.equal(selectRenderer(profile(), 'webgpu'), 'canvas2d');
  assert.equal(selectRenderer(profile(), 'webgl2'), 'canvas2d');
});

test('fallback chain is ordered by fidelity', () => {
  assert.deepEqual([...FALLBACK_CHAIN], ['webgpu', 'webgl2', 'canvas2d', 'dom']);
});

test('createRenderer falls back from webgpu stub to canvas2d in Node (no three)', async () => {
  const r = await createRenderer('webgpu');
  assert.ok(r instanceof Canvas2DRenderer);
  assert.equal(r.backend, 'canvas2d');
});

test('createRenderer falls back from webgl2 when three is absent', async () => {
  const r = await createRenderer('webgl2');
  assert.equal(r.backend, 'canvas2d');
});

test('createRenderer strict mode surfaces the typed error', async () => {
  await assert.rejects(createRenderer('webgpu', { strict: true }), (err) => {
    assert.ok(err instanceof RenderingError);
    assert.equal(err.code, 'UNSUPPORTED_BACKEND');
    assert.equal(err.backend, 'webgpu');
    return true;
  });
});

test('createRenderer constructs dom backend without touching DOM APIs', async () => {
  const r = await createRenderer('dom');
  assert.ok(r instanceof DomRenderer);
});

test('DomRenderer.init throws typed error outside the browser', async () => {
  const r = new DomRenderer();
  await assert.rejects(r.init({}), (err) => err instanceof RenderingError && err.code === 'RENDERER_UNAVAILABLE');
});
