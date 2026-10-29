/**
 * QA regression (FB2): manifest validation hardening for video entries.
 *
 * Run: `node --test test/qa-regression.test.mjs` (after package build).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeManifest, ManifestError } from '../dist/index.js';
import { FIXTURE_MANIFEST } from './fixtures.mjs';

function videoManifest(videoOverrides) {
  return {
    ...FIXTURE_MANIFEST,
    assets: {
      intro: {
        kind: 'video',
        preload: 'eager',
        bytes: 1000,
        duration: 12,
        width: 1920,
        height: 1080,
        poster: '/p.jpg',
        variants: { mp4: { url: '/v.mp4', bytes: 1000, codec: 'h264' } },
        scrubOptimized: true,
        ...videoOverrides,
      },
    },
  };
}

test('valid video entry still normalizes', () => {
  const m = normalizeManifest(videoManifest({}));
  assert.equal(m.assets['intro'].kind, 'video');
});

test('rejects non-string variant urls with a clear ManifestError', () => {
  assert.throws(
    () => normalizeManifest(videoManifest({ variants: { mp4: { url: 42 } } })),
    (err) => err instanceof ManifestError && /mp4.*string url/.test(err.message),
  );
  assert.throws(
    () => normalizeManifest(videoManifest({ variants: { hls: { playlist: null } } })),
    (err) => err instanceof ManifestError && /hls.*playlist/.test(err.message),
  );
});

test('rejects missing/non-finite/negative duration', () => {
  assert.throws(
    () => normalizeManifest(videoManifest({ duration: undefined })),
    (err) => err instanceof ManifestError && /duration/.test(err.message),
  );
  assert.throws(
    () => normalizeManifest(videoManifest({ duration: Number.NaN })),
    (err) => err instanceof ManifestError && /duration/.test(err.message),
  );
  assert.throws(
    () => normalizeManifest(videoManifest({ duration: -1 })),
    (err) => err instanceof ManifestError && /duration/.test(err.message),
  );
  // duration 0 is legal — it means "unknown" for synthesized manifests.
  assert.doesNotThrow(() => normalizeManifest(videoManifest({ duration: 0 })));
});
