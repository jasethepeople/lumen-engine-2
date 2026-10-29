/**
 * @lumen/app-runtime — headless tests.
 *
 * Covers createLumenApp() from a config object and a JSON string, plus
 * listTemplates(). boot() is browser-only: @lumen/runtime's bootEngine
 * guards on `typeof document === 'undefined'` and rejects under Node, so
 * only that guard is asserted here; real boot paths are covered by the
 * engine e2e suite in a DOM environment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLumenApp, listTemplates } from '../dist/index.js';

const showcaseConfig = {
  version: 3,
  id: 'showcase-demo',
  template: 'viewer-3d',
  meta: { title: 'Showcase', description: 'Product showcase test app', locale: 'en' },
  theme: { colors: { accent: '#e0b45c' } },
  assets: [
    { id: 'product-model', src: 'https://media.example.com/lumen/product.glb', kind: 'model', preload: 'critical' },
  ],
  scenes: [
    {
      id: 'stage',
      slot: 'stage',
      nodes: [{ id: 'model', kind: 'mesh', assetId: 'product-model' }],
      track: { driver: 'scroll', durationOrRange: 10 },
      a11y: { label: 'Product model' },
    },
    {
      id: 'hs-1',
      slot: 'hotspots',
      nodes: [{ id: 'h1', kind: 'dom', html: '<p>Detail</p>', meta: { anchor: [0, 0.5, 0.3] } }],
      track: { driver: 'scroll', durationOrRange: 5 },
      a11y: { label: 'Hotspot' },
    },
  ],
  interactions: [
    { id: 'drag', source: 'pointer', gesture: 'pan', scene: 'stage', inputRange: [0, 1], a11yFallback: 'static' },
  ],
  build: { target: 'static', ssr: true, minify: false },
};

test('createLumenApp from a config object composes via the extended registry', async () => {
  const app = await createLumenApp(showcaseConfig);
  assert.equal(app.config.id, 'showcase-demo');
  assert.ok(app.composedScene.sceneGraph.length > 0);
  // product-showcase specialization composed: orbit + auto-rotate tracks.
  const trackIds = app.composedScene.tracks.map((t) => t.id);
  assert.ok(trackIds.includes('track-stage-orbit'));
  assert.ok(trackIds.includes('track-stage-autorotate'));
  assert.ok(app.manifest.assets['product-model'], 'manifest synthesized from config assets');
  assert.equal(typeof app.boot, 'function');
  assert.equal(typeof app.dispose, 'function');
  app.dispose();
});

test('createLumenApp from a JSON string parses and composes', async () => {
  const app = await createLumenApp(JSON.stringify(showcaseConfig));
  assert.equal(app.config.template, 'viewer-3d');
  assert.ok(app.composedScene.tracks.some((t) => t.driver === 'time'));
  app.dispose();
});

test('createLumenApp rejects invalid configs with all errors', async () => {
  await assert.rejects(() => createLumenApp({ id: 'bad' }), /createLumenApp: invalid EngineConfig/);
});

test('listTemplates includes the product-showcase specialization', () => {
  const templates = listTemplates();
  assert.ok(templates.some((t) => t.id === 'product-showcase' && t.kind === 'viewer-3d'));
  assert.ok(templates.some((t) => t.id === 'scroll-cinema-landing' && t.kind === 'scroll-video'));
  assert.ok(templates.some((t) => t.id === 'cinematic-story' && t.kind === 'cinematic-spa'));
  assert.ok(templates.some((t) => t.id === 'storytelling'));
});

test('boot() is browser-only: guarded under Node', async () => {
  const app = await createLumenApp(showcaseConfig);
  await assert.rejects(() => app.boot({}), /requires a DOM/);
  app.dispose();
});
