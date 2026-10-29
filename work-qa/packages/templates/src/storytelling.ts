/**
 * @lumen/templates — 'storytelling' descriptor.
 * Long-scroll text+media blocks; every block gets enter/progress/exit tracks
 * driven by scroll, with sticky media slots pinned during their block range.
 */

import type {
  ComposedScene,
  EngineConfig,
  AssetManifest,
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

export const STORYTELLING_SLOTS: TemplateDescriptor['slots'] = [
  { id: 'block', accepts: ['dom'], min: 1, max: 128, region: 'dom' },
  { id: 'media', accepts: ['video-plane', 'sprite', 'mesh', 'dom'], min: 0, max: 64, region: 'hybrid' },
  { id: 'sticky-media', accepts: ['video-plane', 'sprite', 'mesh'], min: 0, max: 8, region: 'spatial' },
];

export const STORYTELLING_THEME_DEFAULTS: ThemeTokens = {
  colors: {
    background: '#fafaf7',
    foreground: '#1a1a1a',
    accent: '#b3532f',
    surface: '#efeee8',
  },
  typeScale: {
    caption: { size: '0.875rem', lineHeight: 1.4, weight: 400 },
    body: { size: '1.125rem', lineHeight: 1.7, weight: 400 },
    title: { size: '2rem', lineHeight: 1.25, weight: 600 },
    display: { size: '3.5rem', lineHeight: 1.05, weight: 700 },
  },
  spacing: defaultSpacing(),
  motion: defaultMotion(),
};

function composeStorytelling(cfg: EngineConfig, manifest: AssetManifest): ComposedScene {
  resetIds();
  const theme = resolveThemeTokens(STORYTELLING_THEME_DEFAULTS, cfg.theme);

  const tracks: ReturnType<typeof makeTrack>[] = [];
  const sceneRefs = new Map<string, SceneRefEntry>();
  const roots: SceneNode[] = [];
  const islands: string[] = [];

  let offset = 0;
  for (const scene of cfg.scenes) {
    const dur = scene.track.durationOrRange || 1;
    const start = offset;
    const end = offset + dur;
    const sticky = scene.slot === 'sticky-media';
    const groupId = `node-${scene.id}`;

    // Per-block enter/progress/exit tracks, all scroll-driven.
    const enterId = `track-${scene.id}-enter`;
    const progressId = `track-${scene.id}-progress`;
    const exitId = `track-${scene.id}-exit`;

    tracks.push(
      makeTrack(enterId, groupId, 'scroll', [start, start + dur * 0.25], [
        { t: start, value: 0, easing: 'ease-out' },
        { t: start + dur * 0.25, value: 1 },
      ]),
      makeTrack(progressId, groupId, 'scroll', [start, end], [
        { t: start, value: 0, easing: 'linear' },
        { t: end, value: 1, easing: 'linear' },
      ]),
      makeTrack(exitId, groupId, 'scroll', [end - dur * 0.25, end], [
        { t: end - dur * 0.25, value: 1 },
        { t: end, value: 0, easing: 'ease-in' },
      ]),
    );

    const group = makeNode({
      id: groupId,
      kind: 'group',
      layer: sticky ? 8 : scene.slot === 'media' ? 4 : 1,
      bindings: [
        { trackId: enterId, property: 'material.opacity' },
        { trackId: progressId, property: 'transform.position.y' },
        { trackId: exitId, property: 'material.opacity' },
      ],
      meta: {
        storytelling: {
          slot: scene.slot,
          a11y: scene.a11y,
          sticky,
          scrollRange: [start, end],
          theme,
        },
      },
    });

    for (const nc of scene.nodes) {
      const missing =
        (nc.kind === 'mesh' || nc.kind === 'sprite' || nc.kind === 'video-plane') &&
        nc.assetId !== undefined &&
        !manifest.assets[nc.assetId];
      const cfgNode = missing
        ? { ...nc, meta: { ...(nc.meta ?? {}), storytelling: { missingAsset: true } } }
        : nc;
      group.children.push(nodeFromConfig(cfgNode, scene, progressId, group.layer + 1, 'storytelling'));
    }

    roots.push(group);
    sceneRefs.set(scene.id, { nodeId: groupId, trackId: progressId, range: [start, end] });
    if (scene.nodes.some((n) => n.kind === 'dom')) islands.push(groupId);
    offset = end;
  }

  const bindings = resolveBindings(cfg, sceneRefs);
  return assembleScene(roots, tracks, bindings, islands, islands.length > 0);
}

export const storytellingTemplate: TemplateDescriptor = {
  kind: 'storytelling',
  version: '0.1.0',
  slots: STORYTELLING_SLOTS,
  themeTokens: STORYTELLING_THEME_DEFAULTS,
  requiredCapabilities: {
    renderers: ['dom', 'canvas2d'],
    assetFeatures: ['hls', 'lottie'],
    interactions: ['scroll', 'keyboard'],
  },
  budgets: {
    jsGzBytes: 90_000,
    criticalAssetBytes: 1_000_000,
    firstFrameMs: 1_000,
  },
  compose: composeStorytelling,
};
