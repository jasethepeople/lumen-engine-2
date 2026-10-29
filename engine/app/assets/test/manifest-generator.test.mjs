/**
 * HybridManifestGenerator tests — runtime shape assertions against the
 * IRAssetVariant contract consumed by @lumen/assets' pickVariant().
 *
 * Compile-time check: manifest-generator.ts imports `IRAssetVariant` from
 * @lumen/contracts (the exact type packages/assets/src/variants.ts takes);
 * a type drift would fail `tsc -p app/assets/tsconfig.json`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HybridManifestGenerator } from '../dist/index.js';
import { pickVariant } from '@lumen/assets';

const HASH_RE = /^[0-9a-f]{10}$/;

function fullSource() {
  return {
    name: 'hero',
    width: 1280,
    scrubBytes: new Uint8Array([1, 2, 3, 4]),
    frameStacks: [
      { fps: 15, frameCount: 60, bytes: new Uint8Array([5, 6, 7]) },
      { fps: 30, frameCount: 120, bytes: new Uint8Array([8, 9, 10, 11]) },
    ],
    posterBytes: new Uint8Array([12]),
  };
}

test('emits scrub + two frame-stack tiers + poster, all byte-sized', () => {
  const gen = new HybridManifestGenerator();
  const m = gen.generate(fullSource());
  assert.equal(m.id, 'hero');
  assert.equal(m.variants.length, 4);

  const scrub = m.variants.find((v) => v.delivery === 'gop1');
  assert.ok(scrub, 'gop1 scrub variant present');
  assert.equal(scrub.format, 'mp4');
  assert.equal(scrub.codec, 'h264');
  assert.equal(scrub.bytes, 4);
  assert.equal(scrub.width, 1280);
  const scrubHash = /hero\.([0-9a-f]{10})\.mp4$/.exec(scrub.src)?.[1];
  assert.match(scrubHash ?? '', HASH_RE);

  const stacks = m.variants.filter((v) => v.delivery === 'frame-stack');
  assert.deepEqual(stacks.map((s) => s.fps), [15, 30]);
  for (const s of stacks) {
    assert.equal(s.format, 'webp');
    assert.ok(s.frameCount > 0);
    assert.match(s.pattern, /frame-%05d\.webp$/);
    assert.ok(s.bytes > 0);
  }

  const poster = m.variants.find((v) => v.format === 'poster');
  assert.ok(poster, 'poster variant present');
  assert.equal(poster.delivery, 'progressive');
  assert.equal(poster.bytes, 1);

  assert.equal(m.src, scrub.src);
  assert.equal(m.totalBytes, 4 + 3 + 4 + 1);
});

test('variant array is directly consumable by @lumen/assets pickVariant', () => {
  const gen = new HybridManifestGenerator();
  const { variants } = gen.generate(fullSource());
  const profile = {
    codecs: { h264: { supported: true }, hevc: { supported: false }, av1: { supported: false }, vp9: { supported: false } },
    deviceMemoryGB: 8,
    dpr: { current: 1 },
  };
  const picked = pickVariant(profile, variants, 'video', { viewportWidth: 1280 });
  assert.ok(picked, 'pickVariant returned a variant');
  assert.notEqual(picked.codec, 'hevc'); // unsupported codecs filtered
});

test('content hashing: identical bytes → identical names; changed bytes → new name', () => {
  const gen = new HybridManifestGenerator();
  const a = gen.generate({ name: 'x', scrubBytes: new Uint8Array([1]) });
  const b = gen.generate({ name: 'x', scrubBytes: new Uint8Array([1]) });
  const c = gen.generate({ name: 'x', scrubBytes: new Uint8Array([2]) });
  assert.equal(a.src, b.src);
  assert.notEqual(a.src, c.src);
});

test('low-power style source (scrub only) emits a single gop1 variant', () => {
  const gen = new HybridManifestGenerator();
  const m = gen.generate({ name: 'lp', scrubBytes: new Uint8Array([7, 7]) });
  assert.equal(m.variants.length, 1);
  assert.equal(m.variants[0].delivery, 'gop1');
});

test('baseUrl is honored; empty source throws', () => {
  const gen = new HybridManifestGenerator();
  const m = gen.generate({ name: 'n', baseUrl: 'https://cdn.example.com/media', scrubBytes: new Uint8Array([1]) });
  assert.match(m.src, /^https:\/\/cdn\.example\.com\/media\/n\.[0-9a-f]{10}\.mp4$/);
  assert.throws(() => gen.generate({ name: 'empty' }), /no outputs/);
});
