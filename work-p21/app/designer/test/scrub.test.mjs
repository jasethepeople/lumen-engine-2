/**
 * @lumen/app-designer — ScrubController tests.
 * Parity with the engine evaluator at sampled t values, frame quantization,
 * ComposedScene input, seek/step semantics.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrack } from '@lumen/scene';
import { ScrubController, quantizeToFrame } from '@lumen/app-designer';

function sampleTracks() {
  return [
    {
      id: 'hero.track',
      target: 'hero-video-plane',
      driver: 'scroll',
      range: [0, 8],
      keyframes: [
        { t: 0, value: 0 },
        { t: 4, value: 50, easing: 'ease-in-out' },
        { t: 8, value: 100, easingBezier: [0.65, 0, 0.35, 1] },
      ],
    },
    {
      id: 'cam.zoom',
      target: 'cam-1',
      driver: 'time',
      range: [0, 6],
      keyframes: [
        { t: 0, value: 1 },
        { t: 6, value: 2.5, easing: 'ease-out' },
      ],
      segments: [
        { id: 'pulse', from: 2, to: 4, keys: [{ t: 0, value: 1 }, { t: 0.5, value: 1.5 }, { t: 1, value: 1 }] },
      ],
    },
  ];
}

test('evaluateAt matches the engine evaluator at sampled t values', () => {
  const tracks = sampleTracks();
  const scrub = new ScrubController(tracks);
  for (const t of [0, 0.001, 1.2345, 2, 3.14159, 4, 5.5, 7.999, 8, 100]) {
    const sample = scrub.evaluateAt(t);
    assert.equal(sample.t, t);
    for (const track of tracks) {
      assert.equal(
        sample.values[track.id],
        evaluateTrack(track, t),
        `track ${track.id} at t=${t}`,
      );
    }
  }
});

test('accepts a ComposedScene and evaluates its tracks', () => {
  const tracks = sampleTracks();
  const composed = { sceneGraph: [], tracks, bindings: [], hydration: { ssr: false, islands: [] } };
  const scrub = new ScrubController(composed);
  const sample = scrub.evaluateAt(2.5);
  assert.equal(Object.keys(sample.values).length, 2);
  assert.equal(sample.values['hero.track'], evaluateTrack(tracks[0], 2.5));
});

test('seek moves the playhead and samples', () => {
  const scrub = new ScrubController(sampleTracks());
  const s = scrub.seek(3);
  assert.equal(scrub.t, 3);
  assert.equal(s.t, 3);
  assert.ok(typeof s.values['cam.zoom'] === 'number');
});

test('stepFrames quantizes to the 1/fps grid', () => {
  const scrub = new ScrubController(sampleTracks());
  scrub.seek(0);
  const fps = 30;
  let s = scrub.stepFrames(1, fps);
  assert.equal(s.t, 1 / 30);
  s = scrub.stepFrames(29, fps);
  assert.equal(s.t, 1); // frame 30 exactly, no float drift
  // step back
  s = scrub.stepFrames(-15, fps);
  assert.equal(s.t, 0.5);
  // landing on the grid from an off-grid playhead
  scrub.seek(0.4999999);
  s = scrub.stepFrames(0, fps);
  assert.equal(s.t, quantizeToFrame(0.4999999, fps));
  assert.equal(s.t * fps, Math.round(s.t * fps));
  // repeated stepping stays exactly on frame boundaries
  scrub.seek(0);
  for (let i = 0; i < 100; i++) s = scrub.stepFrames(1, 24);
  assert.equal(s.t, 100 / 24);
  assert.equal(scrub.t, 100 / 24);
});

test('stepped samples equal engine evaluation at the quantized time', () => {
  const tracks = sampleTracks();
  const scrub = new ScrubController(tracks);
  scrub.seek(1 / 3);
  const s = scrub.stepFrames(7, 60);
  for (const track of tracks) {
    assert.equal(s.values[track.id], evaluateTrack(track, s.t));
  }
});

test('quantizeToFrame snaps to frame boundaries; rejects bad fps', () => {
  assert.equal(quantizeToFrame(0.499, 1), 0);
  assert.equal(quantizeToFrame(0.5, 1), 1); // round half up
  assert.equal(quantizeToFrame(1 / 3, 60), Math.round((1 / 3) * 60) / 60);
  assert.throws(() => quantizeToFrame(1, 0), /invalid fps/);
  assert.throws(() => new ScrubController([]).stepFrames(1, -24), /invalid fps/);
});

test('loop option is forwarded to the engine evaluator', () => {
  const track = sampleTracks()[0];
  const clamped = new ScrubController([track]);
  const looped = new ScrubController([track], { evaluate: { loop: 'loop' } });
  assert.notEqual(looped.evaluateAt(9).values[track.id], clamped.evaluateAt(9).values[track.id]);
  assert.equal(looped.evaluateAt(9).values[track.id], evaluateTrack(track, 9, { loop: 'loop' }));
});
