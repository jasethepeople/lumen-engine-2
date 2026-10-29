/**
 * SceneIR deep structural validation (describeSceneIRError / isSceneIR /
 * parseSceneIR). Run against compiled dists: `node --test test/ir.test.mjs`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeSceneIRError, isSceneIR, manifestFromAssetRefs, parseSceneIR } from '../dist/index.js';
import { SCENE_IR_VERSION } from '../../../contracts/dist/index.js';

function validIR() {
  return {
    version: SCENE_IR_VERSION,
    site: { id: 'site-1', title: 'T', description: '', locale: 'en' },
    template: 'scroll-video',
    theme: {},
    nodes: [
      {
        id: 'node-a',
        kind: 'group',
        transform: { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] },
        layer: 0,
        visible: true,
        bindings: [],
        children: [
          {
            id: 'node-b',
            kind: 'video-plane',
            transform: { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] },
            layer: 0,
            visible: true,
            assetId: 'vid',
            bindings: [],
            children: [],
          },
        ],
      },
    ],
    tracks: [
      { id: 'track-1', target: 'node-b', driver: 'scroll', range: [0, 10], keyframes: [] },
    ],
    bindings: [
      {
        id: 'bind-1',
        source: 'scroll',
        targetNodeId: 'node-b',
        targetTrackId: 'track-1',
        mapping: { inputRange: [0, 1], outputRange: [0, 10] },
        a11yFallback: 'static',
      },
    ],
    assets: [{ id: 'vid', src: '/media/hero.mp4', kind: 'video' }],
    hydration: { ssr: false, islands: [] },
    a11y: {},
  };
}

test('valid IR passes all checks', () => {
  const ir = validIR();
  assert.equal(isSceneIR(ir), true);
  assert.equal(describeSceneIRError(ir), null);
  assert.equal(parseSceneIR(ir), ir);
  assert.equal(parseSceneIR(JSON.stringify(ir)).site.id, 'site-1');
});

test('version mismatch is rejected with a descriptive error', () => {
  const ir = { ...validIR(), version: 99 };
  assert.equal(isSceneIR(ir), false);
  assert.match(describeSceneIRError(ir), /version mismatch: expected 1, got 99/);
  assert.throws(() => parseSceneIR(ir), /invalid SceneIR document — SceneIR version mismatch/);
});

test('track targeting an unknown node fails', () => {
  const ir = validIR();
  ir.tracks[0].target = 'ghost';
  assert.equal(isSceneIR(ir), false);
  assert.match(describeSceneIRError(ir), /track 'track-1' targets unknown node "ghost"/);
});

test('track targeting a nested node resolves (deep walk)', () => {
  const ir = validIR();
  ir.tracks[0].target = 'node-b'; // nested child, not a root
  assert.equal(describeSceneIRError(ir), null);
});

test('binding referencing an unknown track fails', () => {
  const ir = validIR();
  ir.bindings[0].targetTrackId = 'nope';
  assert.match(describeSceneIRError(ir), /binding 'bind-1' references unknown track "nope"/);
});

test('duplicate node ids are rejected', () => {
  const ir = validIR();
  ir.nodes[0].children[0].id = 'node-a';
  assert.match(describeSceneIRError(ir), /duplicate node id 'node-a'/);
});

test('duplicate track ids are rejected', () => {
  const ir = validIR();
  ir.tracks.push({ ...ir.tracks[0] });
  assert.match(describeSceneIRError(ir), /duplicate track id 'track-1'/);
});

test('assets require non-empty ids and src urls', () => {
  const ir = validIR();
  ir.assets[0].id = '';
  assert.match(describeSceneIRError(ir), /non-empty string id/);
  const ir2 = validIR();
  ir2.assets[0].src = '';
  assert.match(describeSceneIRError(ir2), /asset 'vid' requires a non-empty src url/);
});

test('non-object and missing-shape inputs fail clearly', () => {
  assert.match(describeSceneIRError(null), /must be an object/);
  assert.match(describeSceneIRError({ version: 1 }), /site/);
  assert.match(describeSceneIRError({ ...validIR(), tracks: {} }), /'tracks' to be an array/);
});

// ---------- P2: variant-driven manifest synthesis ----------

test('P2: ref without variants takes the legacy synthesis path (snapshot)', () => {
  const manifest = manifestFromAssetRefs([
    { id: 'img', src: '/a.png', kind: 'image' },
    { id: 'vid', src: '/v.mp4', kind: 'video', duration: 5 },
  ]);
  assert.deepEqual(manifest.assets.img, {
    id: 'img',
    preload: 'lazy',
    bytes: 0,
    kind: 'image',
    width: 0,
    height: 0,
    variants: { fallback: { url: '/a.png', mime: 'image/*' } },
  });
  assert.deepEqual(manifest.assets.vid, {
    id: 'vid',
    preload: 'lazy',
    bytes: 0,
    kind: 'video',
    duration: 5,
    width: 0,
    height: 0,
    poster: '',
    variants: { mp4: { url: '/v.mp4', bytes: 0, codec: 'h264' } },
    scrubOptimized: true,
  });
});

test('P2: ref with variants produces a faithful pass-through manifest entry', () => {
  const manifest = manifestFromAssetRefs([
    {
      id: 'img',
      src: '/a.png',
      kind: 'image',
      variants: [
        { src: '/a-400.avif', format: 'avif', width: 400, delivery: 'progressive' },
        { src: '/a-800.webp', format: 'webp', width: 800, delivery: 'progressive' },
        { src: '/a.png', delivery: 'progressive' },
      ],
    },
  ]);
  const entry = manifest.assets.img;
  assert.deepEqual(entry.variants.avif.srcset, { 400: '/a-400.avif' });
  assert.deepEqual(entry.variants.webp.srcset, { 800: '/a-800.webp' });
  assert.equal(entry.variants.fallback.url, '/a.png');
  assert.equal(entry.irVariants.length, 3);
});

test('P2: video without a gop1 variant is not scrubOptimized', () => {
  const manifest = manifestFromAssetRefs([
    {
      id: 'vid',
      src: '/v.mp4',
      kind: 'video',
      duration: 3,
      variants: [
        { src: '/v.mp4', format: 'mp4', codec: 'hevc', bytes: 10, delivery: 'progressive' },
        { src: '/v.webm', format: 'webm', delivery: 'progressive' },
        { src: '/v.m3u8', format: 'hls', delivery: 'hls' },
        { src: '/p.jpg', format: 'poster', delivery: 'progressive' },
      ],
    },
  ]);
  const entry = manifest.assets.vid;
  assert.equal(entry.scrubOptimized, false);
  assert.equal(entry.variants.mp4.codec, 'hevc');
  assert.equal(entry.variants.webm.url, '/v.webm');
  assert.equal(entry.variants.hls.playlist, '/v.m3u8');
  assert.equal(entry.poster, '/p.jpg');
  assert.equal(entry.duration, 3);
});

test('P2: gop1 variant marks the entry scrubOptimized', () => {
  const manifest = manifestFromAssetRefs([
    {
      id: 'vid',
      src: '/v.mp4',
      kind: 'video',
      variants: [{ src: '/v.mp4', format: 'mp4', codec: 'h264', delivery: 'gop1' }],
    },
  ]);
  assert.equal(manifest.assets.vid.scrubOptimized, true);
});

test('P2: empty variants array is treated as absent', () => {
  const manifest = manifestFromAssetRefs([{ id: 'img', src: '/a.png', kind: 'image', variants: [] }]);
  assert.deepEqual(manifest.assets.img.variants, { fallback: { url: '/a.png', mime: 'image/*' } });
});

test('P2: round-trip lower→raise preserves variant count', () => {
  // Synthesize wire variants the way codegen would, then raise back.
  const wire = [
    { src: '/v.mp4', format: 'mp4', codec: 'h264', bytes: 9, delivery: 'gop1' },
    { src: '/v.webm', format: 'webm', bytes: 8, delivery: 'gop1' },
    { src: '/p.jpg', format: 'poster', delivery: 'progressive' },
  ];
  const manifest = manifestFromAssetRefs([{ id: 'v', src: '/v.mp4', kind: 'video', variants: wire }]);
  assert.equal(manifest.assets.v.irVariants.length, wire.length);
  assert.equal(manifest.assets.v.scrubOptimized, true);
});

// ---------- P1: motion fields on the wire ----------

test('P1: v1 doc without motion validates (byte-identical behavior)', () => {
  const ir = validIR();
  assert.equal(isSceneIR(ir), true);
  assert.equal('motion' in ir.tracks[0], false);
});

test('P1: track motion override and a11y scene default are accepted', () => {
  const ir = validIR();
  ir.tracks[0].motion = 'reveal';
  ir.a11y = { hero: { label: 'Hero', motion: 'static' } };
  assert.equal(isSceneIR(ir), true);
  const parsed = parseSceneIR(ir);
  assert.equal(parsed.tracks[0].motion, 'reveal');
  assert.equal(parsed.a11y.hero.motion, 'static');
});

test('P1: unknown motion values are tolerated (validation stays structural)', () => {
  const ir = validIR();
  ir.tracks[0].motion = 'warp-9';
  assert.equal(isSceneIR(ir), true); // ignored, not rejected
});

// ---------- P15: smoothing/segments/bezier on the wire ----------

test('P15: v1 doc without smoothing/segments validates; new fields tolerated', () => {
  const ir = validIR();
  assert.equal(isSceneIR(ir), true);
  ir.tracks[0].smoothing = { mode: 'spring', stiffness: 0.1, damping: 0.85 };
  ir.tracks[0].segments = [{ id: 's', from: 0, to: 5, keys: [{ t: 0, value: 0 }] }];
  ir.tracks[0].keyframes = [{ t: 0, value: 0, easingBezier: [0.42, 0, 0.58, 1] }];
  assert.equal(isSceneIR(ir), true);
  const parsed = parseSceneIR(ir);
  assert.equal(parsed.tracks[0].smoothing.mode, 'spring');
  assert.equal(parsed.tracks[0].segments.length, 1);
});

// --- P11: dom payload richness round-trips lower -> raise -------------------
{
  const { lowerToIR } = await import('../../codegen/dist/index.js');
  const { composedSceneFromIR } = await import('../dist/index.js');

  const config = {
    version: 3,
    id: 'p11',
    template: 'scroll-video',
    meta: { title: 'P11', description: '', locale: 'en' },
    theme: {},
    assets: [],
    scenes: [{ id: 's1', slot: 'main', nodes: [], a11y: { label: 'S1' } }],
    interactions: [],
    build: { target: 'static' },
  };
  const defaults = {
    colors: {},
    typeScale: {},
    spacing: {},
    motion: { standard: [0.4, 0, 0.2, 1], emphasized: [0.2, 0, 0, 1], duration: { fast: 150, slow: 600 } },
  };
  const domNode = {
    id: 'd1',
    kind: 'dom',
    transform: { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] },
    layer: 3,
    visible: true,
    bindings: [],
    children: [],
    payload: {
      html: '<p>x</p>',
      anchor: [1, 2, 3],
      rect: { x: 10, y: 20, width: 300, height: 40 },
      layerGroup: 'hero',
    },
  };
  const scene = { sceneGraph: [domNode], tracks: [], bindings: [], hydration: { ssr: false, islands: [] } };

  test('anchor/rect/layerGroup round-trip lower→raise', () => {
    const ir = lowerToIR(config, defaults, scene);
    const irNode = ir.nodes[0];
    assert.deepEqual(irNode.anchor, [1, 2, 3]);
    assert.deepEqual(irNode.rect, { x: 10, y: 20, width: 300, height: 40 });
    assert.equal(irNode.layerGroup, 'hero');
    const raised = composedSceneFromIR(ir);
    assert.deepEqual(raised.sceneGraph[0].payload, domNode.payload);
  });

  test('absent richness fields stay absent (legacy payload unchanged)', () => {
    const plain = { ...domNode, id: 'd2', payload: { html: '<p>y</p>' } };
    const ir = lowerToIR(config, defaults, { ...scene, sceneGraph: [plain] });
    const irNode = ir.nodes[0];
    assert.equal('anchor' in irNode, false);
    assert.equal('rect' in irNode, false);
    assert.equal('layerGroup' in irNode, false);
    const raised = composedSceneFromIR(ir);
    assert.deepEqual(raised.sceneGraph[0].payload, { html: '<p>y</p>' });
  });
}
