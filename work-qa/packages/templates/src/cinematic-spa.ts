/**
 * @lumen/templates — 'cinematic-spa' descriptor.
 * Sequenced full-screen scenes with time-driven timelines, hero/gallery/outro
 * slots, and entrance/exit keyframes per scene.
 */

import type {
  ComposedScene,
  EngineConfig,
  AssetManifest,
  Keyframe,
  SceneNode,
  TemplateDescriptor,
  ThemeTokens,
} from '@lumen/contracts';
import {
  assembleScene,
  makeNode,
  makeTrack,
  nodeFromConfig,
  resetIds,
  resolveBindings,
  type SceneRefEntry,
} from './internal.js';
import { defaultMotion, defaultSpacing, defaultTypeScale, resolveThemeTokens } from './theme.js';

export const CINEMATIC_SPA_SLOTS: TemplateDescriptor['slots'] = [
  { id: 'hero', accepts: ['video-plane', 'dom', 'mesh', 'sprite'], min: 1, max: 1, region: 'hybrid' },
  { id: 'gallery', accepts: ['dom', 'sprite', 'mesh'], min: 0, max: 16, region: 'hybrid' },
  { id: 'outro', accepts: ['dom'], min: 0, max: 1, region: 'dom' },
];

export const CINEMATIC_SPA_THEME_DEFAULTS: ThemeTokens = {
  colors: {
    background: '#0b0b10',
    foreground: '#f5f5f7',
    accent: '#d4a24e',
    surface: '#16161e',
  },
  typeScale: defaultTypeScale(),
  spacing: defaultSpacing(),
  motion: {
    ...defaultMotion(),
    duration: { fast: 200, medium: 450, slow: 900 },
  },
};

/** Entrance/exit keyframe set over a scene's time range. */
function entranceExitKeyframes(start: number, dur: number): Keyframe[] {
  const fade = Math.min(dur * 0.2, 0.6);
  return [
    { t: start, value: 0, easing: 'ease-out' },
    { t: start + fade, value: 1 },
    { t: start + dur - fade, value: 1 },
    { t: start + dur, value: 0, easing: 'ease-in' },
  ];
}

function composeCinematicSpa(cfg: EngineConfig, manifest: AssetManifest): ComposedScene {
  resetIds();
  const theme = resolveThemeTokens(CINEMATIC_SPA_THEME_DEFAULTS, cfg.theme);

  const tracks: ReturnType<typeof makeTrack>[] = [];
  const sceneRefs = new Map<string, SceneRefEntry>();
  const roots: SceneNode[] = [];
  const islands: string[] = [];

  let clock = 0;
  for (const scene of cfg.scenes) {
    const dur = scene.track.durationOrRange || 1;
    const trackId = `track-${scene.id}`;
    const groupId = `node-${scene.id}`;

    const track = makeTrack(trackId, groupId, 'time', [clock, clock + dur], entranceExitKeyframes(clock, dur));
    tracks.push(track);

    const group = makeNode({
      id: groupId,
      kind: 'group',
      layer: scene.slot === 'hero' ? 10 : scene.slot === 'gallery' ? 5 : 1,
      bindings: [{ trackId, property: 'material.opacity' }],
      meta: {
        'cinematic-spa': {
          slot: scene.slot,
          a11y: scene.a11y,
          theme,
          sequenceStart: clock,
          sequenceEnd: clock + dur,
        },
      },
    });

    for (const nc of scene.nodes) {
      // Mesh/sprite/video payloads resolve against the manifest; missing assets
      // are kept but flagged in meta for build-time warnings (no config mutation).
      const missing =
        (nc.kind === 'mesh' || nc.kind === 'sprite' || nc.kind === 'video-plane') &&
        nc.assetId !== undefined &&
        !manifest.assets[nc.assetId];
      const cfgNode = missing
        ? { ...nc, meta: { ...(nc.meta ?? {}), 'cinematic-spa': { missingAsset: true } } }
        : nc;
      group.children.push(nodeFromConfig(cfgNode, scene, trackId, group.layer + 1, 'cinematic-spa'));
    }

    roots.push(group);
    sceneRefs.set(scene.id, { nodeId: groupId, trackId, range: [clock, clock + dur] });
    if (scene.nodes.some((n) => n.kind === 'dom')) islands.push(groupId);
    clock += dur;
  }

  const bindings = resolveBindings(cfg, sceneRefs);
  return assembleScene(roots, tracks, bindings, islands, islands.length > 0);
}

export const cinematicSpaTemplate: TemplateDescriptor = {
  kind: 'cinematic-spa',
  version: '0.1.0',
  slots: CINEMATIC_SPA_SLOTS,
  themeTokens: CINEMATIC_SPA_THEME_DEFAULTS,
  requiredCapabilities: {
    renderers: ['webgl2', 'dom'],
    assetFeatures: ['hls', 'lottie'],
    interactions: ['scroll', 'pointer', 'keyboard'],
  },
  budgets: {
    jsGzBytes: 160_000,
    criticalAssetBytes: 2_500_000,
    firstFrameMs: 2_000,
  },
  compose: composeCinematicSpa,
};
