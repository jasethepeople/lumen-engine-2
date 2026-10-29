import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeManifest,
  isAssetManifest,
  resolveAssetUrl,
  groupByPriority,
  primaryUrl,
  contentHashKey,
  ManifestError,
} from '../dist/manifest.js';
import { FIXTURE_MANIFEST } from './fixtures.mjs';

test('normalizeManifest fills entry ids from keys and preserves entries', () => {
  const manifest = normalizeManifest(FIXTURE_MANIFEST);
  assert.equal(manifest.version, 1);
  assert.equal(Object.keys(manifest.assets).length, 6);
  for (const [id, entry] of Object.entries(manifest.assets)) {
    assert.equal(entry.id, id);
  }
});

test('normalizeManifest rejects wrong version', () => {
  assert.throws(() => normalizeManifest({ ...FIXTURE_MANIFEST, version: 2 }), ManifestError);
});

test('normalizeManifest rejects entry with id/key mismatch', () => {
  const bad = structuredClone(FIXTURE_MANIFEST);
  bad.assets.hero.id = 'other';
  assert.throws(() => normalizeManifest(bad), /does not match/);
});

test('normalizeManifest rejects image without fallback url', () => {
  const bad = structuredClone(FIXTURE_MANIFEST);
  delete bad.assets.hero.variants.fallback;
  assert.throws(() => normalizeManifest(bad), /variants\.fallback\.url/);
});

test('normalizeManifest rejects video without any variant', () => {
  const bad = structuredClone(FIXTURE_MANIFEST);
  bad.assets.intro.variants = {};
  assert.throws(() => normalizeManifest(bad), /at least one of hls\/mp4\/webm/);
});

test('normalizeManifest rejects unknown preload priority', () => {
  const bad = structuredClone(FIXTURE_MANIFEST);
  bad.assets.logo.preload = 'whenever';
  assert.throws(() => normalizeManifest(bad), /preload/);
});

test('isAssetManifest guards without throwing', () => {
  assert.equal(isAssetManifest(FIXTURE_MANIFEST), true);
  assert.equal(isAssetManifest({ version: 1 }), false);
  assert.equal(isAssetManifest(null), false);
});

test('resolveAssetUrl joins CDN base with relative paths', () => {
  assert.equal(resolveAssetUrl('/assets/h/x.jpg', 'https://cdn.example.com'), 'https://cdn.example.com/assets/h/x.jpg');
  assert.equal(resolveAssetUrl('assets/h/x.jpg', 'https://cdn.example.com/'), 'https://cdn.example.com/assets/h/x.jpg');
});

test('resolveAssetUrl passes absolute and data URLs through', () => {
  assert.equal(resolveAssetUrl('https://other.cdn/x.jpg', 'https://cdn.example.com'), 'https://other.cdn/x.jpg');
  assert.equal(resolveAssetUrl('data:image/png;base64,AAA', 'https://cdn.example.com'), 'data:image/png;base64,AAA');
  assert.equal(resolveAssetUrl('/x.jpg'), '/x.jpg');
});

test('groupByPriority buckets ids in load order', () => {
  const groups = groupByPriority(normalizeManifest(FIXTURE_MANIFEST));
  assert.deepEqual(groups.critical.sort(), ['bodyFont', 'hero']);
  assert.deepEqual(groups.eager.sort(), ['chair', 'intro']);
  assert.deepEqual(groups.lazy, ['logo', 'theme']); // sorted for determinism
});

test('primaryUrl picks the best transferable URL per kind', () => {
  const m = normalizeManifest(FIXTURE_MANIFEST);
  assert.equal(primaryUrl(m.assets.hero), '/assets/bbbb2222/hero.jpg');
  assert.equal(primaryUrl(m.assets.intro), '/assets/cccc3333/intro.mp4'); // scrub prefers mp4
  assert.equal(primaryUrl(m.assets.chair), '/assets/0000aaaa/chair.glb');
  assert.equal(primaryUrl(m.assets.theme), '/assets/ffff6666/theme.opus');
});

test('contentHashKey extracts the hash segment from CDN paths', () => {
  const m = normalizeManifest(FIXTURE_MANIFEST);
  assert.equal(contentHashKey(m.assets.hero), 'image:bbbb2222');
  assert.equal(contentHashKey(m.assets.chair), 'model:0000aaaa');
  // No hash-shaped segment: falls back to url#bytes.
  const plain = { ...m.assets.logo, url: '/static/logo.json' };
  assert.equal(contentHashKey(plain), 'lottie:/static/logo.json#50000');
});
