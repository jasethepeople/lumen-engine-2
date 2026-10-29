import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scrollCinemaLandingTemplate,
  createExtendedRegistry,
  HERO_CAPTION_FADE_FRACTION,
  OUTRO_FADE_FRACTION,
  PARALLAX_SCALE,
  normalizeScrollRange,
} from '../dist/index.js';
import { makeConfig, makeManifest, scene, assertComposedSceneValid } from './fixtures.mjs';

const fullConfig = () =>
  makeConfig('scroll-video', [
    scene('stage-1', 'stage', [{ id: 'v1', kind: 'video-plane', assetId: 'hero-video' }], 'scroll', 10),
    scene('logo-1', 'logo', [{ id: 'lg', kind: 'dom', html: '<span>ACME</span>' }], 'scroll', 10),
    scene('hero-1', 'hero-caption', [{ id: 'h1', kind: 'dom', html: '<h1>Hello</h1>' }], 'scroll', 10),
    scene('ch-1', 'chapters', [{ id: 'c1', kind: 'dom', html: '<p>One</p>' }], 'scroll', 2),
    scene('ch-2', 'chapters', [{ id: 'c2', kind: 'dom', html: '<p>Two</p>', meta: { scrollRange: [4, 6] } }], 'scroll', 2),
    scene('outro-1', 'outro', [{ id: 'o1', kind: 'dom', html: '<p>End</p>' }], 'scroll', 10),
  ]);

test('scroll-cinema-landing composes a valid scene with all slots populated', () => {
  const out = scrollCinemaLandingTemplate.compose(fullConfig(), makeManifest());
  assertComposedSceneValid(out);

  const video = out.sceneGraph.find((n) => n.kind === 'video-plane');
  assert.ok(video, 'video plane present');
  assert.equal(video.payload.scrubbed, true);

  // Scrub track: 0..duration across the full scroll range.
  const scrub = out.tracks.find((t) => t.id.endsWith('-scrub'));
  assert.ok(scrub);
  assert.deepEqual(scrub.range, [0, 10]);
  assert.equal(scrub.keyframes.at(-1).value, 12, 'scrubs to manifest video duration');

  // Parallax scale track: 1.0 -> 1.08 across the full range.
  const parallax = out.tracks.find((t) => t.id.endsWith('-parallax'));
  assert.ok(parallax);
  assert.deepEqual(parallax.range, [0, 10]);
  assert.equal(parallax.keyframes[0].value, PARALLAX_SCALE[0]);
  assert.equal(parallax.keyframes.at(-1).value, PARALLAX_SCALE[1]);
  assert.ok(video.bindings.some((b) => b.trackId === parallax.id && b.property === 'transform.scale'));
});

test('scroll-cinema-landing hero caption fades out over first 15%, outro fades in over last 12%', () => {
  const out = scrollCinemaLandingTemplate.compose(fullConfig(), makeManifest());

  const heroTrack = out.tracks.find((t) => t.id === 'track-hero-1');
  assert.deepEqual(heroTrack.range, [0, 10 * HERO_CAPTION_FADE_FRACTION]);
  assert.equal(heroTrack.keyframes[0].value, 1);
  assert.equal(heroTrack.keyframes.at(-1).value, 0);

  const outroTrack = out.tracks.find((t) => t.id === 'track-outro-1');
  assert.deepEqual(outroTrack.range, [10 * (1 - OUTRO_FADE_FRACTION), 10]);
  assert.equal(outroTrack.keyframes[0].value, 0);
  assert.equal(outroTrack.keyframes.at(-1).value, 1);
});

test('scroll-cinema-landing chapters get fade-in/hold/fade-out windows, honoring meta.scrollRange', () => {
  const out = scrollCinemaLandingTemplate.compose(fullConfig(), makeManifest());
  const ch1 = out.tracks.find((t) => t.id === 'track-ch-1');
  const ch2 = out.tracks.find((t) => t.id === 'track-ch-2');

  for (const t of [ch1, ch2]) {
    assert.equal(t.keyframes.length, 4, 'fade-in/hold/fade-out keyframes');
    assert.equal(t.keyframes[0].value, 0);
    assert.equal(t.keyframes[1].value, 1);
    assert.equal(t.keyframes[2].value, 1);
    assert.equal(t.keyframes[3].value, 0);
  }
  // ch-2 carries an explicit meta.scrollRange override on its first node.
  assert.deepEqual(ch2.range, [4, 6]);

  // Logo is a static node: present, no opacity track targeting it.
  const logo = out.sceneGraph.find((n) => n.id === 'node-logo-1');
  assert.ok(logo, 'logo node present');
  assert.ok(!out.tracks.some((t) => t.target === logo.id), 'logo has no track');
});

test('scroll-cinema-landing registry validation warns on slot violations', () => {
  const registry = createExtendedRegistry();
  // Extended registry specializes 'scroll-video' to scroll-cinema-landing.
  assert.equal(registry.require('scroll-video'), scrollCinemaLandingTemplate);

  const bad = makeConfig('scroll-video', [
    scene('s', 'nope', [{ id: 'x', kind: 'dom', html: '' }], 'scroll', 1),
    scene('ch', 'chapters', [{ id: 'm', kind: 'mesh', assetId: 'product-model' }], 'scroll', 1),
  ]);
  const { valid, warnings } = registry.validate(bad);
  assert.equal(valid, false);
  assert.ok(warnings.some((w) => w.path === 'scenes.s.slot'), 'unknown slot warned');
  assert.ok(warnings.some((w) => w.path === 'scenes.ch.nodes.m'), 'unaccepted node kind warned');
  assert.ok(warnings.some((w) => w.path === 'slots.stage'), 'missing stage warned');
});

test('scroll-cinema-landing parallax scale defaults to PARALLAX_SCALE and honors meta override', () => {
  const out = scrollCinemaLandingTemplate.compose(fullConfig(), makeManifest());
  const parallax = out.tracks.find((t) => t.id.includes('parallax'));
  assert.deepEqual(
    [parallax.keyframes[0].value, parallax.keyframes.at(-1).value],
    [PARALLAX_SCALE[0], PARALLAX_SCALE[1]],
  );
  const video = out.sceneGraph.find((n) => n.kind === 'video-plane');
  assert.deepEqual(video.meta['scroll-cinema-landing'].parallaxScale, [1.0, 1.08]);

  // meta.parallax {from, to} on the stage video node overrides the defaults.
  const cfg = makeConfig('scroll-video', [
    scene('stage-1', 'stage', [
      { id: 'v1', kind: 'video-plane', assetId: 'hero-video', meta: { parallax: { from: 0.9, to: 1.2 } } },
    ], 'scroll', 10),
  ]);
  const out2 = scrollCinemaLandingTemplate.compose(cfg, makeManifest());
  const p2 = out2.tracks.find((t) => t.id.includes('parallax'));
  assert.deepEqual([p2.keyframes[0].value, p2.keyframes.at(-1).value], [0.9, 1.2]);
  const v2 = out2.sceneGraph.find((n) => n.kind === 'video-plane');
  assert.deepEqual(v2.meta['scroll-cinema-landing'].parallaxScale, [0.9, 1.2]);

  // Malformed meta falls back to defaults.
  const cfg3 = makeConfig('scroll-video', [
    scene('stage-1', 'stage', [
      { id: 'v1', kind: 'video-plane', assetId: 'hero-video', meta: { parallax: { from: 'x' } } },
    ], 'scroll', 10),
  ]);
  const out3 = scrollCinemaLandingTemplate.compose(cfg3, makeManifest());
  const p3 = out3.tracks.find((t) => t.id.includes('parallax'));
  assert.deepEqual([p3.keyframes[0].value, p3.keyframes.at(-1).value], [1.0, 1.08]);
});

test('scroll-cinema-landing stage poster falls back to the manifest poster frame', () => {
  // Manifest hero-video carries poster '/assets/hero.jpg' -> lands in meta.
  const out = scrollCinemaLandingTemplate.compose(fullConfig(), makeManifest());
  const video = out.sceneGraph.find((n) => n.kind === 'video-plane');
  assert.equal(video.meta['scroll-cinema-landing'].poster, '/assets/hero.jpg');

  // No poster anywhere -> meta key absent (additive, no empty strings).
  const manifest = makeManifest();
  manifest.assets['hero-video'].poster = '';
  const out2 = scrollCinemaLandingTemplate.compose(fullConfig(), manifest);
  const video2 = out2.sceneGraph.find((n) => n.kind === 'video-plane');
  assert.equal('poster' in video2.meta['scroll-cinema-landing'], false);

  // Explicit meta.poster image asset id wins over the video poster frame.
  const manifest2 = makeManifest();
  manifest2.assets['poster-img'] = {
    id: 'poster-img',
    kind: 'image',
    preload: 'lazy',
    bytes: 10,
    width: 10,
    height: 10,
    variants: { fallback: { url: '/assets/poster.webp', mime: 'image/webp' } },
  };
  const cfg = makeConfig('scroll-video', [
    scene('stage-1', 'stage', [
      { id: 'v1', kind: 'video-plane', assetId: 'hero-video', meta: { poster: 'poster-img' } },
    ], 'scroll', 10),
  ]);
  const out3 = scrollCinemaLandingTemplate.compose(cfg, manifest2);
  const video3 = out3.sceneGraph.find((n) => n.kind === 'video-plane');
  assert.equal(video3.meta['scroll-cinema-landing'].poster, '/assets/poster.webp');
});

test('scroll-cinema-landing chapter windows go through normalizeScrollRange', () => {
  // Fully-outside explicit range still falls back to the computed slice.
  const cfg = makeConfig('scroll-video', [
    scene('stage-1', 'stage', [{ id: 'v1', kind: 'video-plane', assetId: 'hero-video' }], 'scroll', 8),
    scene('ch-1', 'chapters', [{ id: 'c1', kind: 'dom', html: '<p>1</p>', meta: { scrollRange: [50, 99] } }], 'scroll', 3),
  ]);
  const out = scrollCinemaLandingTemplate.compose(cfg, makeManifest());
  assertComposedSceneValid(out);
  const t = out.tracks.find((x) => x.id === 'track-ch-1');
  const scrub = out.tracks.find((x) => x.id.includes('scrub'));
  const total = scrub.range[1];
  assert.ok(t.range[1] > t.range[0], 'window non-degenerate');
  assert.ok(t.range[0] >= 0 && t.range[1] <= total, 'window clamped into extent');
  // Falls back to the slice: innerStart .. innerEnd of the 11-unit extent.
  assert.ok(Math.abs(t.range[0] - total * HERO_CAPTION_FADE_FRACTION) < 1e-9);
  assert.ok(Math.abs(t.range[1] - total * (1 - OUTRO_FADE_FRACTION)) < 1e-9);
});

test('normalizeScrollRange clamps, swaps, and enforces a minimum window', () => {
  assert.deepEqual(normalizeScrollRange(2, 6, 10), [2, 6], 'valid range untouched');
  assert.deepEqual(normalizeScrollRange(-5, 99, 10), [0, 10], 'clamped into extent');
  assert.deepEqual(normalizeScrollRange(8, 2, 10), [2, 8], 'inverted range swapped');
  const [s, e] = normalizeScrollRange(5, 5, 10);
  assert.ok(e - s >= 1e-6, 'min window enforced');
  assert.deepEqual(normalizeScrollRange(5, 5, 10, 0), [5, 5], 'epsilon=0 keeps degenerate');
});
