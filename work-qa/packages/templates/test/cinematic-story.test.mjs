import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cinematicStoryTemplate,
  createExtendedRegistry,
  TITLE_CARD_DURATION_S,
  CROSSFADE_S,
} from '../dist/index.js';
import { makeConfig, makeManifest, scene, assertComposedSceneValid } from './fixtures.mjs';

const storyConfig = () =>
  makeConfig(
    'cinematic-spa',
    [
      scene('title', 'title-card', [{ id: 't1', kind: 'dom', html: '<h1>Story</h1>' }], 'time', TITLE_CARD_DURATION_S),
      scene('act-1', 'acts', [{ id: 'a1', kind: 'dom', html: '<p>Act one</p>' }], 'time', 5),
      scene(
        'act-2',
        'acts',
        [{ id: 'a2', kind: 'dom', html: '<p>Act two</p>', meta: { durationHint: 7 } }],
        'time',
        5,
      ),
      scene('score-1', 'score', [{ id: 's1', kind: 'dom', html: '', meta: { assetId: 'score-audio' } }], 'time', 0),
      scene('credits-1', 'credits', [{ id: 'cr', kind: 'dom', html: '<p>Fin</p>' }], 'time', 4),
    ],
    [{ id: 'kb-next', source: 'keyboard', scene: 'act-1', inputRange: [0, 1], a11yFallback: 'static' }],
  );

test('cinematic-story composes a valid time-driven sequence', () => {
  const out = cinematicStoryTemplate.compose(storyConfig(), makeManifest());
  assertComposedSceneValid(out);
  assert.ok(out.tracks.every((t) => t.driver === 'time'), 'all tracks time-driven');

  const title = out.tracks.find((t) => t.id === 'track-title');
  assert.deepEqual(title.range, [0, TITLE_CARD_DURATION_S]);

  // Acts overlap by CROSSFADE_S; act-2 uses its meta.durationHint (7s).
  const act1 = out.tracks.find((t) => t.id === 'track-act-1');
  const act2 = out.tracks.find((t) => t.id === 'track-act-2');
  assert.deepEqual(act1.range, [TITLE_CARD_DURATION_S - CROSSFADE_S, TITLE_CARD_DURATION_S - CROSSFADE_S + 5]);
  const act2Start = act1.range[1] - CROSSFADE_S;
  assert.deepEqual(act2.range, [act2Start, act2Start + 7], 'durationHint overrides track duration');

  // Crossfade keyframes: linear easing throughout (reduced-motion ready cuts).
  for (const t of out.tracks) {
    assert.ok(t.keyframes.every((k) => k.easing === 'linear'), `${t.id} linear easings`);
    assert.equal(t.keyframes.length, 4);
  }

  // Reduced-motion cut flag on every sequenced node.
  const groups = out.sceneGraph.filter((n) => n.kind === 'group');
  for (const g of groups) {
    assert.deepEqual(g.meta['cinematic-story'].reducedMotion, { transition: 'cut', easing: 'linear' });
  }
});

test('cinematic-story carries a score node referencing an audio asset', () => {
  const out = cinematicStoryTemplate.compose(storyConfig(), makeManifest());
  const score = out.sceneGraph.find((n) => n.id === 'node-score-1');
  assert.ok(score, 'score node present');
  // Fixture manifest has no audio entry; the declared assetId is preserved.
  assert.equal(score.meta['cinematic-story'].assetId, 'score-audio');
  assert.equal(score.meta['cinematic-story'].autoplay, true);
});

test('cinematic-story resolves keyboard navigation bindings (scene:next/prev contract)', () => {
  const out = cinematicStoryTemplate.compose(storyConfig(), makeManifest());
  assert.equal(out.bindings.length, 1);
  assert.equal(out.bindings[0].source, 'keyboard');
  assert.equal(out.bindings[0].targetTrackId, 'track-act-1');
});

test('cinematic-story registry validation warns on slot violations', () => {
  const registry = createExtendedRegistry();
  assert.equal(registry.require('cinematic-spa'), cinematicStoryTemplate);

  const bad = makeConfig('cinematic-spa', [
    scene('only-act', 'acts', [{ id: 'a', kind: 'dom', html: '' }], 'time', 3),
    scene('wild', 'gallery', [{ id: 'g', kind: 'dom', html: '' }], 'time', 3),
  ]);
  const { valid, warnings } = registry.validate(bad);
  assert.equal(valid, false);
  assert.ok(warnings.some((w) => w.path === 'scenes.wild.slot'), 'unknown slot warned');
  assert.ok(warnings.some((w) => w.path === 'slots.acts' && w.message.includes('at least 2')), 'acts min warned');
});
