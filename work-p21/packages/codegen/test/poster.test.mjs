/**
 * P17 — SSR poster fallback: ssrSkeleton emits a real
 * `<img data-lumen-poster>` for video assets with a poster in the
 * build-pipeline manifest; gen-static marks the skeleton with
 * data-lumen-skeleton="1". Run against compiled dists: `node --test test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generate } from '../dist/index.js';
import { makeConfig, makeDescriptor, makeOptions, makeScene } from './fixtures.mjs';

function makeManifest() {
  return {
    version: 1,
    generatedAt: '2024-01-01T00:00:00.000Z',
    assets: {
      'hero-video': {
        id: 'hero-video',
        kind: 'video',
        preload: 'critical',
        bytes: 0,
        duration: 10,
        width: 1920,
        height: 1080,
        poster: '/media/hero-poster.jpg',
        variants: {},
        scrubOptimized: false,
      },
    },
  };
}

function indexHtml(res) {
  return res.files.find((f) => f.path === 'index.html').source;
}

test('static SSR skeleton carries the data-lumen-skeleton marker', () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('static'));
  assert.match(indexHtml(res), /data-lumen-skeleton="1"/);
});

test('poster <img data-lumen-poster> emitted for video poster variant when manifest given', () => {
  const res = generate(
    makeConfig(),
    makeDescriptor(),
    makeScene(),
    makeOptions('static'),
    makeManifest(),
  );
  const html = indexHtml(res);
  assert.match(html, /data-lumen-skeleton="1"/);
  assert.match(html, /<img data-lumen-poster src="\/media\/hero-poster\.jpg"/);
  // Poster sits inside the spatial placeholder of the hero video node.
  assert.match(html, /data-node="n-vid"[^>]*role="img"[^>]*><img data-lumen-poster/);
  // Assets without a manifest entry (ghost-asset) get no poster.
  assert.doesNotMatch(html, /data-node="n-ghost"[^>]*><img/);
});

test('no poster img without a manifest (graceful absence)', () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('static'));
  const html = indexHtml(res);
  assert.doesNotMatch(html, /data-lumen-poster/);
  // Marker still present — the skeleton itself is independent of posters.
  assert.match(html, /data-lumen-skeleton="1"/);
});
