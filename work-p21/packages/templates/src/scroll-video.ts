/**
 * @lumen/templates — 'scroll-video' descriptor.
 * Full-viewport scrub-optimized video plane with a scroll-driven scrub
 * timeline and caption overlay slots.
 */

import type {
  ComposedScene,
  EngineConfig,
  AssetManifest,
  SceneNode,
  TemplateDescriptor,
  TimelineTrack,
  ThemeTokens,
} from '@lumen/contracts';
import {
  assembleScene,
  firstAssetOfKind,
  makeNode,
  makeTrack,
  manifestEntry,
  nodeFromConfig,
  normalizeScrollRange,
  resetIds,
  resolveBindings,
  type SceneRefEntry,
} from './internal.js';
import { defaultMotion, defaultSpacing, defaultTypeScale, resolveThemeTokens } from './theme.js';

export const SCROLL_VIDEO_SLOTS: TemplateDescriptor['slots'] = [
  {
    id: 'stage',
    accepts: ['video-plane'],
    min: 1,
    max: 1,
    region: 'spatial',
  },
  {
    id: 'caption',
    accepts: ['dom', 'sprite'],
    min: 0,
    max: 32,
    region: 'dom',
  },
];

export const SCROLL_VIDEO_THEME_DEFAULTS: ThemeTokens = {
  colors: {
    background: '#000000',
    foreground: '#ffffff',
    accent: '#8ab4ff',
    'caption-bg': 'rgba(0, 0, 0, 0.55)',
  },
  typeScale: defaultTypeScale(),
  spacing: defaultSpacing(),
  motion: defaultMotion(),
};

function composeScrollVideo(cfg: EngineConfig, manifest: AssetManifest): ComposedScene {
  resetIds();
  const theme = resolveThemeTokens(SCROLL_VIDEO_THEME_DEFAULTS, cfg.theme);

  const stageScenes = cfg.scenes.filter((s) => s.slot === 'stage');
  const captionScenes = cfg.scenes.filter((s) => s.slot === 'caption');

  // Total scroll extent across stage + caption scenes.
  const rangeOf = (d: number): number => (Number.isFinite(d) && d > 0 ? d : 1);
  const totalRange = cfg.scenes.reduce((sum, s) => sum + rangeOf(s.track.durationOrRange), 0) || 1;

  const tracks: TimelineTrack[] = [];
  const sceneRefs = new Map<string, SceneRefEntry>();

  // Stage: one full-viewport video plane, scrubbed by a scroll track.
  const stageScene = stageScenes[0];
  const videoRef = stageScene?.nodes.find((n) => n.kind === 'video-plane' && n.assetId);
  const videoAsset = manifestEntry(manifest, videoRef?.assetId) ?? firstAssetOfKind(manifest, 'video');
  const videoAssetId = videoRef?.assetId ?? videoAsset?.id ?? '';
  const videoDuration =
    videoAsset?.kind === 'video' && Number.isFinite(videoAsset.duration) && videoAsset.duration > 0
      ? videoAsset.duration
      : totalRange;

  const scrubTrackId = `track-${stageScene?.id ?? 'stage'}-scrub`;
  const scrubTrack: TimelineTrack = makeTrack(
    scrubTrackId,
    `node-${stageScene?.id ?? 'stage'}-video`,
    'scroll',
    [0, totalRange],
    [
      { t: 0, value: 0, easing: 'linear' },
      { t: totalRange, value: videoDuration, easing: 'linear' },
    ],
  );
  tracks.push(scrubTrack);

  const videoNode = makeNode({
    id: `node-${stageScene?.id ?? 'stage'}-video`,
    kind: 'video-plane',
    layer: 0,
    transform: { scale: [1, 1, 1] },
    payload: { assetId: videoAssetId, scrubbed: true },
    bindings: [{ trackId: scrubTrackId, property: 'playback.time', easing: 'linear' }],
    meta: {
      'scroll-video': {
        slot: 'stage',
        a11y: stageScene?.a11y ?? { label: 'Background video' },
        theme,
      },
    },
  });
  if (stageScene)
    sceneRefs.set(stageScene.id, {
      nodeId: videoNode.id,
      trackId: scrubTrackId,
      range: [0, totalRange],
    });

  // Captions: DOM overlay nodes, each with a scroll-driven visibility track.
  const captionNodes: SceneNode[] = [];
  let offset = stageScene ? rangeOf(stageScene.track.durationOrRange) : 0;
  for (const scene of captionScenes) {
    const dur = rangeOf(scene.track.durationOrRange);
    const trackId = `track-${scene.id}`;
    const group = makeNode({
      id: `node-${scene.id}`,
      kind: 'group',
      layer: 1,
      meta: { 'scroll-video': { slot: 'caption', a11y: scene.a11y } },
    });
    // Caption window, normalized against the total scroll extent (identity
    // for the contiguous slices computed above; guards hand-built configs).
    const [winStart, winEnd] = normalizeScrollRange(offset, offset + dur, totalRange);
    const fadeTrack = makeTrack(trackId, group.id, 'scroll', [winStart, winEnd], [
      { t: offset, value: 0, easing: 'ease-in' },
      { t: offset + dur * 0.15, value: 1 },
      { t: offset + dur * 0.85, value: 1 },
      { t: offset + dur, value: 0, easing: 'ease-out' },
    ]);
    tracks.push(fadeTrack);
    group.bindings.push({ trackId, property: 'material.opacity' });
    for (const nc of scene.nodes) {
      group.children.push(nodeFromConfig(nc, scene, trackId, 2, 'scroll-video'));
    }
    captionNodes.push(group);
    sceneRefs.set(scene.id, { nodeId: group.id, trackId, range: [offset, offset + dur] });
    offset += dur;
  }

  const bindings = resolveBindings(cfg, sceneRefs);
  const islands = captionScenes.map((s) => `node-${s.id}`);
  return assembleScene([videoNode, ...captionNodes], tracks, bindings, islands, captionScenes.length > 0);
}

export const scrollVideoTemplate: TemplateDescriptor = {
  kind: 'scroll-video',
  version: '0.1.0',
  slots: SCROLL_VIDEO_SLOTS,
  themeTokens: SCROLL_VIDEO_THEME_DEFAULTS,
  requiredCapabilities: {
    renderers: ['webgl2', 'canvas2d'],
    assetFeatures: ['hls'],
    interactions: ['scroll', 'touch'],
  },
  budgets: {
    jsGzBytes: 120_000,
    criticalAssetBytes: 1_500_000,
    firstFrameMs: 1_500,
  },
  compose: composeScrollVideo,
};
