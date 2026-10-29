/**
 * @lumen/app-designer — motion graph + reduced-motion overlay tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '@lumen/config';
import { createMotionPolicy } from '@lumen/runtime';
import { annotate, buildMotionGraph, reducedMotionOverlay } from '@lumen/app-designer';

function makeConfig() {
  const raw = {
    version: 3,
    id: 'graph-test',
    template: 'scroll-video',
    meta: { title: 'G', description: 'g', locale: 'en' },
    theme: {},
    assets: [{ id: 'v', src: 'https://media.example.com/v.mp4', kind: 'video' }],
    scenes: [
      {
        id: 'hero',
        slot: 'stage',
        nodes: [{ id: 'hero-video-plane', kind: 'video-plane', assetId: 'v' }],
        track: { driver: 'scroll', durationOrRange: 8 },
        a11y: { label: 'Hero' },
      },
      {
        id: 'calm',
        slot: 'caption',
        nodes: [{ id: 'calm-text', kind: 'dom', html: '<p>hi</p>' }],
        track: { driver: 'time', durationOrRange: 4 },
        a11y: { label: 'Calm', motion: 'static' },
      },
    ],
    interactions: [
      { id: 'scroll-main', source: 'scroll', scene: 'hero', inputRange: [0, 1], a11yFallback: 'steps' },
      { id: 'drag-1', source: 'touch', gesture: 'pan', scene: 'calm', inputRange: [0, 300] },
    ],
    build: { target: 'static' },
  };
  const result = parseConfig(raw);
  assert.ok(result.ok, JSON.stringify(result.ok ? null : result.errors));
  return result.config;
}

test('buildMotionGraph: scene, driver, track, and node vertices', () => {
  const graph = buildMotionGraph(makeConfig());
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  assert.equal(byId.get('hero').kind, 'scene');
  assert.equal(byId.get('calm').kind, 'scene');
  assert.equal(byId.get('hero.track').kind, 'track');
  assert.equal(byId.get('calm.track').kind, 'track');
  assert.equal(byId.get('driver:scroll').kind, 'driver');
  assert.equal(byId.get('driver:time').kind, 'driver');
  assert.equal(byId.get('driver:gesture:pan').kind, 'driver');
  assert.equal(byId.get('hero-video-plane').kind, 'node');
  assert.equal(byId.get('calm-text').kind, 'node');
});

test('buildMotionGraph: driver -> track -> node edges and binding edges', () => {
  const graph = buildMotionGraph(makeConfig());
  const ids = new Set(graph.edges.map((e) => e.id));
  assert.ok(ids.has('drives:driver:scroll->hero.track'));
  assert.ok(ids.has('drives:driver:time->calm.track'));
  assert.ok(ids.has('drives:driver:gesture:pan->calm.track'));
  assert.ok(ids.has('targets:hero.track->hero-video-plane'));
  assert.ok(ids.has('targets:calm.track->calm-text'));
  assert.ok(ids.has('contains:hero->hero-video-plane'));
  assert.ok(ids.has('binds:scroll-main->hero.track'));
  assert.ok(ids.has('binds:drag-1->calm.track'));
  // edge ids unique
  assert.equal(ids.size, graph.edges.length);
});

test('reducedMotionOverlay: full motion annotates everything continuous', () => {
  const graph = buildMotionGraph(makeConfig());
  const overlay = reducedMotionOverlay(graph, { reducedMotion: false });
  assert.equal(overlay.policyMode, 'continuous');
  for (const edge of overlay.edges) {
    if (edge.id.includes('calm.track')) continue; // scene override below
    if (edge.kind === 'contains' && edge.from === 'calm') continue;
    if (edge.id.includes('calm')) continue;
    assert.equal(edge.reducedMotion.mode, 'continuous', edge.id);
    assert.equal(edge.reducedMotion.behavior, 'full');
    assert.equal(edge.reducedMotion.timeAdvances, true);
  }
  // per-scene 'static' override wins even under full motion
  const calmTrackEdges = overlay.edges.filter((e) => e.id.includes('calm.track'));
  for (const edge of calmTrackEdges) {
    assert.equal(edge.reducedMotion.mode, 'static', edge.id);
    assert.equal(edge.reducedMotion.behavior, 'static');
    assert.equal(edge.reducedMotion.timeAdvances, false);
  }
});

test('reducedMotionOverlay: reduced motion maps to reveal by default', () => {
  const overlay = reducedMotionOverlay(buildMotionGraph(makeConfig()), { reducedMotion: true });
  assert.equal(overlay.policyMode, 'reveal');
  const heroEdges = overlay.edges.filter((e) => e.id.includes('hero.track'));
  assert.ok(heroEdges.length > 0);
  for (const edge of heroEdges) {
    assert.equal(edge.reducedMotion.mode, 'reveal', edge.id);
    assert.equal(edge.reducedMotion.behavior, 'reveal');
    // reveal: time still passes (per MotionPolicy semantics)
    assert.equal(edge.reducedMotion.timeAdvances, true);
  }
});

test('reducedMotionOverlay: wire scene default beats the reduced-motion flag', () => {
  const overlay = reducedMotionOverlay(buildMotionGraph(makeConfig()), {
    reducedMotion: true,
    sceneDefault: 'continuous',
  });
  assert.equal(overlay.policyMode, 'continuous');
});

test('overlay annotation matches MotionPolicy.trackMode semantics', () => {
  // Same resolution path as the engine: track override ?? scene mode.
  const policy = createMotionPolicy({ reducedMotion: true });
  assert.equal(annotate(policy.trackMode({ motion: 'static' })).behavior, 'static');
  assert.equal(annotate(policy.trackMode({})).behavior, 'reveal');
  const full = createMotionPolicy({ reducedMotion: false });
  assert.equal(annotate(full.trackMode({})).behavior, 'full');
});
