/**
 * DeviceClassDetector matrix + pickPipelineProfile mapping tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDeviceClass, pickPipelineProfile } from '../dist/index.js';

const MATRIX = [
  // [input, expected]
  [{}, 'desktop'],
  [{ hardwareConcurrency: 8, deviceMemory: 16 }, 'desktop'],
  [{ hardwareConcurrency: 2 }, 'low-power'],
  [{ hardwareConcurrency: 1 }, 'low-power'],
  [{ deviceMemory: 2 }, 'low-power'],
  [{ deviceMemory: 1 }, 'low-power'],
  [{ deviceMemory: 4 }, 'mobile'],
  [{ deviceMemory: 8 }, 'desktop'],
  [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' }, 'mobile'],
  [{ userAgent: 'Mozilla/5.0 (Linux; Android 14)' }, 'mobile'],
  [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' }, 'desktop'],
  // Mobile UA + modest memory classifies downward to low-power.
  [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148', deviceMemory: 4 }, 'low-power'],
  [{ userAgent: 'Android 10', deviceMemory: 8 }, 'mobile'],
  [{ screenWidth: 375 }, 'mobile'],
  [{ screenWidth: 767 }, 'mobile'],
  [{ screenWidth: 768 }, 'desktop'],
  [{ screenWidth: 1920 }, 'desktop'],
  // Conflicts classify downward (conservative).
  [{ hardwareConcurrency: 16, deviceMemory: 2, screenWidth: 2560 }, 'low-power'],
  [{ hardwareConcurrency: 8, screenWidth: 390 }, 'mobile'],
];

test('detectDeviceClass matrix', () => {
  for (const [input, expected] of MATRIX) {
    assert.equal(detectDeviceClass(input), expected, JSON.stringify(input));
  }
});

test('pickPipelineProfile: desktop → full hybrid set at 15/30 fps', () => {
  const p = pickPipelineProfile('desktop');
  assert.deepEqual(p.ops, ['probe', 'scrub-mp4', 'frame-stack', 'manifest']);
  assert.deepEqual(p.frameStackFps, [15, 30]);
  assert.equal(p.poster, true);
});

test('pickPipelineProfile: mobile → frame-stack biased at 12/24 fps', () => {
  const p = pickPipelineProfile('mobile');
  assert.deepEqual(p.ops, ['probe', 'scrub-mp4', 'frame-stack', 'manifest']);
  assert.deepEqual(p.frameStackFps, [12, 24]);
  assert.equal(p.poster, true);
});

test('pickPipelineProfile: low-power → scrub only, no frame stack, no poster', () => {
  const p = pickPipelineProfile('low-power');
  assert.ok(!p.ops.includes('frame-stack'));
  assert.deepEqual(p.frameStackFps, []);
  assert.equal(p.poster, false);
  assert.match(p.rationale, /[Ss]crub/);
});

test('profile deviceClass round-trips', () => {
  for (const cls of ['desktop', 'mobile', 'low-power']) {
    assert.equal(pickPipelineProfile(cls).deviceClass, cls);
  }
});
