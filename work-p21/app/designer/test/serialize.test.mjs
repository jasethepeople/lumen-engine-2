/**
 * @lumen/app-designer — serialization tests.
 * Round-trip fidelity (config -> timeline -> config deep-equal) and
 * parseConfig validation of the emitted SceneConfig JSON.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '@lumen/config';
import {
  TimelineEditor,
  configToTimeline,
  createTimelineDocument,
  timelineDocToTrack,
  timelineToConfig,
  wrapInEngineConfig,
} from '@lumen/app-designer';

const BASE_CONFIG = {
  version: 3,
  id: 'designer-test',
  template: 'scroll-video',
  meta: { title: 'Designer Test', description: 'round-trip', locale: 'en' },
  theme: {},
  assets: [{ id: 'hero-video', src: 'https://media.example.com/hero.mp4', kind: 'video' }],
  interactions: [],
  build: { target: 'static', ssr: true, minify: false },
};

/** A fully-loaded engine track JSON exercising every field. */
function sampleTrack() {
  return {
    id: 'hero.track',
    target: 'hero-video-plane',
    driver: 'scroll',
    range: [0, 8],
    keyframes: [
      { t: 0, value: 0, easing: 'linear' },
      { t: 2, value: [0, 1, 0], easing: 'ease-in-out' },
      { t: 5, value: [4, 1, 0], easing: 'ease-out', easingBezier: [0.22, 0.61, 0.36, 1] },
      { t: 8, value: 'done' },
    ],
    motion: 'reveal',
    smoothing: { mode: 'spring', stiffness: 0.4, damping: 0.8 },
    segments: [
      {
        id: 'bounce',
        from: 2,
        to: 5,
        keys: [
          { t: 0, value: 0 },
          { t: 0.5, value: 1, easingBezier: [0.34, 1.56, 0.64, 1] },
          { t: 1, value: 0 },
        ],
      },
    ],
  };
}

test('track JSON -> timeline -> track JSON deep-equals (round trip)', () => {
  const track = sampleTrack();
  const doc = configToTimeline(track);
  const out = timelineDocToTrack(doc);
  assert.deepEqual(out, track);
});

test('config output -> timeline -> config output deep-equals', () => {
  const doc = createTimelineDocument({
    id: 'cap.track',
    sceneId: 'captions',
    target: 'caption-title',
    driver: 'time',
    range: [0, 4],
  });
  const ed = new TimelineEditor(doc);
  ed.addKeyframe({ t: 0, value: 0 });
  ed.addKeyframe({ t: 4, value: 100, easingBezier: [0.65, 0, 0.35, 1] });
  ed.addSegment({ id: 'mid', from: 1, to: 3, keys: [{ t: 0, value: 0 }, { t: 1, value: 1 }] });
  ed.setSmoothing({ mode: 'lerp', stiffness: 0.2 });
  ed.setMotionMode('static');

  const cfg1 = timelineToConfig(doc, { slot: 'caption', label: 'Captions' });
  const doc2 = configToTimeline(cfg1);
  const cfg2 = timelineToConfig(doc2, { slot: 'caption', label: 'Captions' });
  assert.deepEqual(cfg2, cfg1);
  // and the track alone round-trips through a bare load
  assert.deepEqual(timelineDocToTrack(configToTimeline(cfg1.track)), cfg1.track);
});

test('keyframes keep stable order; designer ids stripped on serialize', () => {
  const doc = configToTimeline(sampleTrack());
  for (const k of doc.keyframes) assert.ok(k.id, 'designer id assigned');
  const out = timelineDocToTrack(doc);
  for (const k of out.keyframes) assert.equal('id' in k, false);
  assert.deepEqual(out.keyframes.map((k) => k.t), [0, 2, 5, 8]);
});

test('minimal track (no optional fields) round-trips without adding keys', () => {
  const track = { id: 't', target: 'n', keyframes: [{ t: 0, value: 1 }], driver: 'time', range: [0, 1] };
  const out = timelineDocToTrack(configToTimeline(track));
  assert.deepEqual(out, track);
  assert.equal('segments' in out, false);
  assert.equal('smoothing' in out, false);
  assert.equal('motion' in out, false);
});

test('emitted SceneConfig passes parseConfig inside a full EngineConfig', () => {
  const doc = configToTimeline(sampleTrack());
  const out = timelineToConfig(doc, {
    slot: 'stage',
    label: 'Hero',
    nodes: [{ id: 'hero-video-plane', kind: 'video-plane', assetId: 'hero-video' }],
  });
  const config = wrapInEngineConfig([out], BASE_CONFIG);
  const result = parseConfig(JSON.parse(JSON.stringify(config)));
  assert.ok(result.ok, JSON.stringify(result.ok ? null : result.errors, null, 2));
  const scene = result.config.scenes.find((s) => s.id === 'hero.track');
  assert.ok(scene);
  assert.equal(scene.track.driver, 'scroll');
  assert.equal(scene.track.durationOrRange, 8);
  assert.equal(scene.a11y.motion, 'reveal');
});

test('configToTimeline rejects malformed input', () => {
  assert.throws(() => configToTimeline({ hello: 'world' }), /malformed/);
  assert.throws(() => configToTimeline({ track: { id: 'x' } }), /malformed/);
});
