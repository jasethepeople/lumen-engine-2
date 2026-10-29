import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultRegistry, TemplateRegistry } from '../dist/index.js';
import { makeConfig, scene } from './fixtures.mjs';

test('default registry has all four kinds with capabilities', () => {
  const reg = createDefaultRegistry();
  assert.deepEqual(reg.kinds().sort(), ['cinematic-spa', 'scroll-video', 'storytelling', 'viewer-3d']);
  const caps = reg.capabilities();
  assert.deepEqual(caps['viewer-3d'].renderers, ['webgl2']);
  assert.ok(caps['scroll-video'].assetFeatures.includes('hls'));
});

test('validation warns about missing required slot content', () => {
  const reg = createDefaultRegistry();
  const cfg = makeConfig('scroll-video', []); // stage slot requires min 1
  const res = reg.validate(cfg);
  assert.equal(res.valid, false);
  assert.ok(res.warnings.some((w) => w.path === 'slots.stage'));
});

test('validation warns about unknown slots and unaccepted node kinds', () => {
  const reg = createDefaultRegistry();
  const cfg = makeConfig('scroll-video', [
    scene('x', 'bogus-slot', []),
    scene('s', 'stage', [{ id: 'd', kind: 'dom' }]), // stage accepts only video-plane
  ]);
  const res = reg.validate(cfg);
  assert.ok(res.warnings.some((w) => w.message.includes('unknown slot')));
  assert.ok(res.warnings.some((w) => w.message.includes('not accepted')));
});

test('validation warns about dangling interactions', () => {
  const reg = createDefaultRegistry();
  const cfg = makeConfig('viewer-3d', [scene('m', 'model', [])], [
    { id: 'i', source: 'pointer', scene: 'ghost', inputRange: [0, 1] },
  ]);
  const res = reg.validate(cfg);
  assert.ok(res.warnings.some((w) => w.path === 'interactions.i'));
});

test('clean config validates with no warnings', () => {
  const reg = createDefaultRegistry();
  const cfg = makeConfig('storytelling', [scene('b', 'block', [{ id: 'n', kind: 'dom' }])]);
  const res = reg.validate(cfg);
  assert.equal(res.valid, true);
  assert.equal(res.warnings.length, 0);
});

test('empty registry require() throws', () => {
  const reg = new TemplateRegistry();
  assert.throws(() => reg.require('scroll-video'));
  assert.equal(reg.get('scroll-video'), undefined);
});
