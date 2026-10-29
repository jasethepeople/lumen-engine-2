/**
 * P7 — pickVariant: capability-aware variant selection.
 * Run against compiled dist: `node --test test/variants.test.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pickVariant } from '../dist/index.js';

const codec = (supported) => ({ supported, smooth: supported, powerEfficient: supported });

function makeProfile(overrides = {}) {
  return {
    webgl2: true,
    webgpu: false,
    offscreenCanvas: true,
    codecs: { h264: codec(true), hevc: codec(true), av1: codec(true), vp9: codec(true) },
    maxTextureSize: 4096,
    deviceMemoryGB: 8,
    reducedMotion: false,
    dpr: { min: 1, max: 2, current: 2 },
    ...overrides,
  };
}

const VIDEO_VARIANTS = [
  { src: '/v-h264.mp4', format: 'mp4', codec: 'h264', width: 1920, delivery: 'gop1' },
  { src: '/v-hevc.mp4', format: 'mp4', codec: 'hevc', width: 1920, delivery: 'gop1' },
];

test('undefined profile ⇒ undefined (legacy fallback preserved)', () => {
  assert.equal(pickVariant(undefined, VIDEO_VARIANTS, 'video'), undefined);
});

test('empty variants ⇒ undefined', () => {
  assert.equal(pickVariant(makeProfile(), [], 'video'), undefined);
});

test('codec filter drops hevc when unsupported', () => {
  const profile = makeProfile({ codecs: { h264: codec(true), hevc: codec(false), av1: codec(false), vp9: codec(true) } });
  const variants = [
    { src: '/v-hevc.mp4', format: 'mp4', codec: 'hevc', delivery: 'gop1' },
    { src: '/v-h264.mp4', format: 'mp4', codec: 'h264', delivery: 'gop1' },
  ];
  assert.equal(pickVariant(profile, variants, 'video').src, '/v-h264.mp4');
});

test('all codecs unsupported ⇒ never starves, falls back to first', () => {
  const profile = makeProfile({ codecs: { h264: codec(false), hevc: codec(false), av1: codec(false), vp9: codec(false) } });
  assert.equal(pickVariant(profile, VIDEO_VARIANTS, 'video').src, '/v-h264.mp4');
});

test('deviceMemory <= 4 prefers a smaller width within the dpr class', () => {
  const profile = makeProfile({ deviceMemoryGB: 4, dpr: { min: 1, max: 1, current: 1 } });
  const variants = [
    { src: '/img-3200.avif', format: 'avif', width: 3200, delivery: 'progressive' },
    { src: '/img-1200.avif', format: 'avif', width: 1200, delivery: 'progressive' },
  ];
  // fitLimit = 1 * 1280 = 1280 → 3200 dropped on low-memory devices.
  assert.equal(pickVariant(profile, variants, 'image').src, '/img-1200.avif');
});

test('dpr fit picks 2x over 1x for a hi-dpi viewport', () => {
  const profile = makeProfile({ dpr: { min: 1, max: 2, current: 2 } });
  const variants = [
    { src: '/img-800.avif', format: 'avif', width: 800, delivery: 'progressive' },
    { src: '/img-1600.avif', format: 'avif', width: 1600, delivery: 'progressive' },
  ];
  // fitLimit = 2560; both within 2× → widest wins.
  assert.equal(pickVariant(profile, variants, 'image').src, '/img-1600.avif');
  // Same widths under dpr 1: 1600 still ≤ 2×1280 → widest wins too.
  const lo = makeProfile({ dpr: { min: 1, max: 1, current: 1 } });
  assert.equal(pickVariant(lo, variants, 'image').src, '/img-1600.avif');
});

test('variants beyond 2x viewport are shed', () => {
  const profile = makeProfile({ dpr: { min: 1, max: 1, current: 1 } });
  const variants = [
    { src: '/img-8000.avif', format: 'avif', width: 8000, delivery: 'progressive' },
    { src: '/img-1000.avif', format: 'avif', width: 1000, delivery: 'progressive' },
  ];
  assert.equal(pickVariant(profile, variants, 'image').src, '/img-1000.avif');
});

test('determinism: same inputs ⇒ same variant across runs', () => {
  const profile = makeProfile();
  const a = pickVariant(profile, VIDEO_VARIANTS, 'video');
  const b = pickVariant(profile, VIDEO_VARIANTS, 'video');
  assert.deepEqual(a, b);
});

test('unsized variants keep declaration order (author intent)', () => {
  const profile = makeProfile();
  const variants = [
    { src: '/v.mp4', format: 'mp4', codec: 'h264', delivery: 'gop1' },
    { src: '/v.webm', format: 'webm', delivery: 'gop1' },
  ];
  assert.equal(pickVariant(profile, variants, 'video').src, '/v.mp4');
});
