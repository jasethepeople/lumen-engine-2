/**
 * P8 — version-skew graceful degradation (parse level): parseSceneIR throws
 * VersionSkewError (with expected/got semver fields) when a document's
 * minRuntime is newer than this runtime; isSceneIR structural validation
 * still accepts the same v1 documents.
 *
 * Deviation (documented): boot-level DOM behavior (SSR skeleton preserved +
 * engine:error IR_VERSION_SKEW emission) is not covered here — no DOM
 * harness exists in this package; coverage is parse-level only.
 *
 * Run against compiled dists: `node --test test/skew.test.mjs`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LUMEN_RUNTIME_VERSION,
  VersionSkewError,
  isSceneIR,
  parseSceneIR,
} from '../dist/index.js';
import { SCENE_IR_VERSION } from '../../../contracts/dist/index.js';

function validIR(overrides = {}) {
  return {
    version: SCENE_IR_VERSION,
    site: { id: 'site-1', title: 'T', description: '', locale: 'en' },
    template: 'scroll-video',
    theme: {},
    nodes: [],
    tracks: [],
    bindings: [],
    assets: [],
    hydration: { ssr: false, islands: [] },
    a11y: {},
    ...overrides,
  };
}

/** Bump the major component of a semver string. */
function nextMajor(v) {
  const [major, ...rest] = v.split('.').map((p) => Number.parseInt(p, 10) || 0);
  return [major + 1, ...rest].join('.');
}

test('parseSceneIR throws VersionSkewError on minRuntime mismatch', () => {
  const required = nextMajor(LUMEN_RUNTIME_VERSION);
  const ir = validIR({ minRuntime: required });
  assert.throws(
    () => parseSceneIR(ir),
    (err) => {
      assert.ok(err instanceof VersionSkewError);
      assert.equal(err.name, 'VersionSkewError');
      assert.equal(err.expected, required);
      assert.equal(err.got, LUMEN_RUNTIME_VERSION);
      assert.match(err.message, /IR_VERSION_SKEW/);
      return true;
    },
  );
});

test('parseSceneIR throws VersionSkewError for JSON string input too', () => {
  const required = nextMajor(LUMEN_RUNTIME_VERSION);
  assert.throws(() => parseSceneIR(JSON.stringify(validIR({ minRuntime: required }))), VersionSkewError);
});

test('parseSceneIR accepts equal/older/absent minRuntime', () => {
  assert.equal(parseSceneIR(validIR()).version, SCENE_IR_VERSION);
  assert.equal(parseSceneIR(validIR({ minRuntime: LUMEN_RUNTIME_VERSION })).minRuntime, LUMEN_RUNTIME_VERSION);
  assert.equal(parseSceneIR(validIR({ minRuntime: '0.0.1' })).minRuntime, '0.0.1');
});

test('isSceneIR still accepts v1 documents regardless of minRuntime', () => {
  assert.equal(isSceneIR(validIR()), true);
  assert.equal(isSceneIR(validIR({ minRuntime: LUMEN_RUNTIME_VERSION })), true);
  // Structural validation is skew-agnostic: even a future minRuntime is a
  // valid v1 document — only booting it is rejected.
  assert.equal(isSceneIR(validIR({ minRuntime: nextMajor(LUMEN_RUNTIME_VERSION) })), true);
});
