/**
 * tests/saas-smoke — (g) AI: generateSceneIRFromDescription passes
 * parseConfig; motion suggestions shape.
 *
 * The facade's ai slot is the local-only seam (identical hosted/offline),
 * re-exporting @lumen/app-ai — this asserts it through BOTH the facade slot
 * and the package directly (same module instance).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '@lumen/config';
import { createOfflineBackend } from '@lumen/backend-supabase';
import {
  HeuristicProvider,
  generateSceneIRFromDescription,
  suggestMotionProfiles,
} from '@lumen/app-ai';

test('(g) facade ai slot exposes the local provider seam', () => {
  const backend = createOfflineBackend();
  assert.equal(backend.ai.HeuristicProvider, HeuristicProvider);
  assert.equal(backend.ai.generateSceneIRFromDescription, generateSceneIRFromDescription);
});

test('(g) generateSceneIRFromDescription output passes parseConfig', async () => {
  const backend = createOfflineBackend();
  const config = await backend.ai.generateSceneIRFromDescription(
    'A calm minimal portfolio with 3 chapters about mountains, oceans and forests',
  );
  const result = parseConfig(config);
  assert.ok(result.ok, JSON.stringify(result.ok ? null : result.errors));
  assert.equal(config.version, 3);
  assert.equal(config.scenes.length, 3);

  // Deterministic: identical prompt → identical config.
  const again = await generateSceneIRFromDescription(
    'A calm minimal portfolio with 3 chapters about mountains, oceans and forests',
  );
  assert.deepEqual(config, again);
});

test('(g) motion suggestions match the contract shape per scene', async () => {
  const config = await generateSceneIRFromDescription(
    'video hero landing with 2 chapters about surfing',
  );
  const suggestions = suggestMotionProfiles(config);
  assert.equal(suggestions.length, config.scenes.length);
  for (const s of suggestions) {
    assert.ok(typeof s.sceneId === 'string' && s.sceneId.length > 0);
    assert.ok(['continuous', 'reveal', 'static'].includes(s.suggested.motion));
    assert.ok(typeof s.rationale === 'string' && s.rationale.length > 0);
    if (s.suggested.smoothing) {
      assert.ok(['lerp', 'spring', 'none'].includes(s.suggested.smoothing.mode));
    }
    if (s.suggested.segments) {
      for (const seg of s.suggested.segments) {
        assert.ok(seg.id && seg.from < seg.to && seg.keys.length >= 2);
      }
    }
  }
  const hero = suggestions.find((s) => s.sceneId === 'hero');
  assert.equal(hero.suggested.motion, 'continuous');
  assert.ok(hero.suggested.smoothing);
});
