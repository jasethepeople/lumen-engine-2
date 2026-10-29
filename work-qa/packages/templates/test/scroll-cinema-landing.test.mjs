import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scrollCinemaLandingTemplate,
  createExtendedRegistry,
  HERO_CAPTION_FADE_FRACTION,
  OUTRO_FADE_FRACTION,
  PARALLAX_SCALE,
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
