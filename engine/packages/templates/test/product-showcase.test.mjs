import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  productShowcaseTemplate,
  createExtendedRegistry,
  createDefaultRegistry,
  PRODUCT_SHOWCASE_ID,
  PRODUCT_SHOWCASE_SLOTS,
  AUTO_ROTATE_PERIOD_S,
} from '../dist/index.js';
import { makeConfig, makeManifest, scene, assertComposedSceneValid } from './fixtures.mjs';

const showcaseConfig = () =>
  makeConfig(
    'viewer-3d',
    [
      scene('stage-1', 'stage', [{ id: 'm1', kind: 'mesh', assetId: 'product-model' }], 'scroll', 10),
      scene('hs-1', 'hotspots', [
        { id: 'h1', kind: 'dom', html: '<p>Brushed steel</p>', meta: { anchor: [0, 0.8, 0.4] } },
      ]),
      scene('hs-2', 'hotspots', [
        { id: 'h2', kind: 'dom', html: '<p>USB-C</p>', meta: { anchor: [0.5, 0.2, 0], scrollRange: [1, 3] } },
      ]),
      scene('spec-1', 'spec-sheet', [{ id: 's1', kind: 'dom', html: '<dl><dt>Weight</dt><dd>220g</dd></dl>' }]),
      scene('cw-1', 'colorways', [
        { id: 'c1', kind: 'dom', html: '<button>Onyx</button>', meta: { variant: { material: 'onyx', color: '#111' } } },
        { id: 'c2', kind: 'dom', html: '<button>Pearl</button>', meta: { variant: { material: 'pearl', color: '#eee' } } },
      ]),
    ],
    [{ id: 'drag', source: 'pointer', gesture: 'drag', scene: 'stage-1', inputRange: [0, 1], a11yFallback: 'static' }],
  );

test('product-showcase composes a valid scene with orbit + auto-rotate tracks', () => {
  const out = productShowcaseTemplate.compose(showcaseConfig(), makeManifest());
  assertComposedSceneValid(out);

  const orbit = out.tracks.find((t) => t.id === 'track-stage-1-orbit');
  assert.equal(orbit.driver, 'pointer');
  assert.deepEqual(orbit.range, [0, Math.PI * 2]);

  const auto = out.tracks.find((t) => t.id === 'track-stage-1-autorotate');
  assert.equal(auto.driver, 'time');
  assert.deepEqual(auto.range, [0, AUTO_ROTATE_PERIOD_S]);
  assert.equal(auto.keyframes.at(-1).value, Math.PI * 2);

  const model = out.sceneGraph.find((n) => n.id === 'node-stage-1');
  assert.equal(model.payload.assetId, 'product-model');
  assert.ok(model.bindings.some((b) => b.trackId === orbit.id && b.property === 'transform.rotationQuat'));
  assert.ok(model.bindings.some((b) => b.trackId === auto.id && b.property === 'transform.rotationQuat'));

  // Auto-rotate pause contract documented via meta.
  const meta = model.meta[PRODUCT_SHOWCASE_ID];
  assert.equal(meta.autoRotate.pauseOn, 'interaction');
  assert.equal(meta.autoRotate.trackId, auto.id);

  // Camera present with template defaults.
  assert.ok(out.sceneGraph.some((n) => n.kind === 'camera' && n.id === 'node-showcase-camera'));
});

test('product-showcase hotspots are scroll-driven with anchors and windows', () => {
  const out = productShowcaseTemplate.compose(showcaseConfig(), makeManifest());
  const hs1 = out.sceneGraph.find((n) => n.id === 'node-hs-1');
  const hs2 = out.sceneGraph.find((n) => n.id === 'node-hs-2');

  const t1 = out.tracks.find((t) => t.id === 'track-hs-1');
  const t2 = out.tracks.find((t) => t.id === 'track-hs-2');
  assert.equal(t1.driver, 'scroll');
  assert.equal(t2.driver, 'scroll');

  // Default windows: equal slices over the stage range (10).
  assert.deepEqual(t1.range, [0, 5]);
  // Explicit meta.scrollRange honored and clamped into [0, 10].
  assert.deepEqual(t2.range, [1, 3]);
  assert.deepEqual(hs2.meta[PRODUCT_SHOWCASE_ID].scrollRange, [1, 3]);

  // Anchors carried from node meta.
  assert.deepEqual(hs1.meta[PRODUCT_SHOWCASE_ID].anchor, [0, 0.8, 0.4]);
  assert.deepEqual(hs2.meta[PRODUCT_SHOWCASE_ID].anchor, [0.5, 0.2, 0]);

  // Fade-in keyframes start at 0 opacity and reach 1.
  assert.equal(t1.keyframes[0].value, 0);
  assert.ok(t1.keyframes.some((k) => k.value === 1));
});

test('product-showcase spec-sheet fades in over the last scroll stretch', () => {
  const out = productShowcaseTemplate.compose(showcaseConfig(), makeManifest());
  const track = out.tracks.find((t) => t.id === 'track-spec-1');
  assert.equal(track.driver, 'scroll');
  assert.deepEqual(track.range, [9, 10]);
  assert.equal(track.keyframes[0].value, 0);
  assert.equal(track.keyframes.at(-1).value, 1);
  const group = out.sceneGraph.find((n) => n.id === 'node-spec-1');
  assert.deepEqual(group.meta[PRODUCT_SHOWCASE_ID].fadeInRange, [9, 10]);
});

test('product-showcase colorways carry variant configs via meta and stay static', () => {
  const out = productShowcaseTemplate.compose(showcaseConfig(), makeManifest());
  const group = out.sceneGraph.find((n) => n.id === 'node-cw-1');
  assert.ok(group, 'colorway group present');
  assert.equal(group.children.length, 2);
  assert.deepEqual(group.children[0].meta[PRODUCT_SHOWCASE_ID].variant, { material: 'onyx', color: '#111' });
  // Static: no tracks target the colorway group, no bindings on children.
  assert.ok(!out.tracks.some((t) => t.target === group.id));
  assert.ok(group.children.every((c) => c.bindings.length === 0));
});

test('product-showcase resolves declarative pointer bindings', () => {
  const out = productShowcaseTemplate.compose(showcaseConfig(), makeManifest());
  assert.equal(out.bindings.length, 1);
  assert.equal(out.bindings[0].source, 'pointer');
  assert.equal(out.bindings[0].targetTrackId, 'track-stage-1-orbit');
});

test('product-showcase registry wiring: extended only, slot warnings', () => {
  const extended = createExtendedRegistry();
  assert.equal(extended.require('viewer-3d'), productShowcaseTemplate);
  // Stock registry keeps the base viewer-3d descriptor (additive change).
  assert.notEqual(createDefaultRegistry().require('viewer-3d'), productShowcaseTemplate);

  const slots = Object.fromEntries(PRODUCT_SHOWCASE_SLOTS.map((s) => [s.id, s]));
  assert.deepEqual(
    [slots.stage.min, slots.stage.max],
    [1, 1],
  );
  assert.equal(slots.hotspots.max, 6);
  assert.equal(slots['spec-sheet'].max, 1);
  assert.equal(slots.colorways.max, 4);

  // Valid config: no warnings.
  const good = extended.validate(showcaseConfig());
  assert.equal(good.valid, true, JSON.stringify(good.warnings));

  // Missing stage + unknown slot + excess hotspots warn.
  const bad = makeConfig('viewer-3d', [
    scene('wild', 'gallery', [{ id: 'g', kind: 'dom', html: '' }], 'scroll', 4),
    ...Array.from({ length: 7 }, (_, i) =>
      scene(`hs-${i}`, 'hotspots', [{ id: `h${i}`, kind: 'dom', html: '' }], 'scroll', 4),
    ),
    scene('cw-bad', 'colorways', [{ id: 'cb', kind: 'mesh', assetId: 'product-model' }], 'scroll', 4),
  ]);
  const { valid, warnings } = extended.validate(bad);
  assert.equal(valid, false);
  assert.ok(warnings.some((w) => w.path === 'slots.stage'), 'stage min warned');
  assert.ok(warnings.some((w) => w.path === 'scenes.wild.slot'), 'unknown slot warned');
  assert.ok(warnings.some((w) => w.path === 'slots.hotspots' && w.message.includes('at most 6')), 'hotspots max warned');
  assert.ok(warnings.some((w) => w.path === 'scenes.cw-bad.nodes.cb'), 'colorway kind warned');
});
