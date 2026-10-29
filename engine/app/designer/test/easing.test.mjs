/**
 * @lumen/app-designer — easing library tests.
 * Every preset is valid per the engine convention and evaluates through the
 * engine's own applyEasing/cubicBezierEase.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEasing, cubicBezierEase } from '@lumen/scene';
import {
  EASING_LIBRARY,
  NAMED_EASING_NAMES,
  asEasing,
  evaluateEasing,
  getEasingPreset,
  isValidBezier,
  isValidEasing,
} from '@lumen/app-designer';

test('library ids are unique and every preset is valid', () => {
  const ids = new Set();
  for (const preset of EASING_LIBRARY) {
    assert.ok(preset.id && !ids.has(preset.id), `duplicate/empty id ${preset.id}`);
    ids.add(preset.id);
    assert.ok(isValidEasing(preset.easing), `invalid easing in ${preset.id}`);
    assert.ok(preset.label.length > 0);
  }
  // All engine named easings are covered by the library.
  for (const name of NAMED_EASING_NAMES) {
    assert.ok(getEasingPreset(name), `missing named easing ${name}`);
  }
});

test('bezier presets satisfy the engine convention and hit endpoints', () => {
  for (const preset of EASING_LIBRARY) {
    if (!Array.isArray(preset.easing)) continue;
    assert.ok(isValidBezier(preset.easing), preset.id);
    const [x1, , x2] = preset.easing;
    assert.ok(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1);
    assert.equal(cubicBezierEase(preset.easing, 0), 0);
    assert.equal(cubicBezierEase(preset.easing, 1), 1);
  }
});

test('evaluateEasing matches the engine evaluator exactly', () => {
  for (const preset of EASING_LIBRARY) {
    for (const t of [0, 0.13, 0.25, 0.5, 0.77, 0.99, 1]) {
      assert.equal(evaluateEasing(preset.easing, t), applyEasing(preset.easing, t));
    }
  }
});

test('isValidBezier rejects malformed control points', () => {
  assert.equal(isValidBezier([0.5, 0, 0.5]), false); // arity
  assert.equal(isValidBezier([-0.1, 0, 0.5, 1]), false); // x out of range
  assert.equal(isValidBezier([0, 0, Number.NaN, 1]), false);
  assert.equal(isValidBezier('ease-in'), false);
  assert.equal(isValidBezier([0, -0.5, 1, 1.5]), true); // y overshoot allowed
});

test('asEasing narrows unknown values', () => {
  assert.equal(asEasing('ease-in'), 'ease-in');
  assert.deepEqual(asEasing([0.25, 0.1, 0.25, 1]), [0.25, 0.1, 0.25, 1]);
  assert.equal(asEasing('bounce'), undefined);
  assert.equal(asEasing(42), undefined);
});
