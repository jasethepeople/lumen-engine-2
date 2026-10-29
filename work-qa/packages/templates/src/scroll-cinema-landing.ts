/**
 * @lumen/templates — 'scroll-cinema-landing' descriptor (kind: 'scroll-video').
 * A specialization of the scroll-video frontend type: a premium scroll-scrubbed
 * cinematic landing page with a fixed stage video (parallax scale), an optional
 * logo, a hero caption that fades out over the first 15% of scroll, up to six
 * chapter overlays with fade-in/hold/fade-out windows, and an outro that fades
 * in over the last 12%.
 *
 * Distinct from the stock `scrollVideoTemplate` by descriptor id/name (see
 * `SCROLL_CINEMA_LANDING_ID`), its slot set, and its `meta['scroll-cinema-landing']`
 * node namespacing. TemplateKind is frozen, so `kind` stays 'scroll-video'.
 */

import type {
  ComposedScene,
  EngineConfig,
  AssetManifest,
  Keyframe,
  SceneNode,
  TemplateDescriptor,
  ThemeTokens,
  TimelineTrack,
} from '@lumen/contracts';
import {
  assembleScene,
  firstAssetOfKind,
  makeNode,
  makeTrack,
  manifestEntry,
  nodeFromConfig,
  resetIds,
  resolveBindings,
  type SceneRefEntry,
} from './internal.js';
import { defaultMotion, defaultSpacing, defaultTypeScale, resolveThemeTokens } from './theme.js';

/** Stable descriptor id; distinguishes this specialization from scrollVideoTemplate. */
export const SCROLL_CINEMA_LANDING_ID = 'scroll-cinema-landing';

/** Fraction of total scroll over which the hero caption fades out. */
export const HERO_CAPTION_FADE_FRACTION = 0.15;
/** Fraction of total scroll over which the outro fades in. */
export const OUTRO_FADE_FRACTION = 0.12;
/** Parallax scale endpoints for the video plane across full scroll. */
export const PARALLAX_SCALE: [number, number] = [1.0, 1.08];

export const SCROLL_CINEMA_LANDING_SLOTS: TemplateDescriptor['slots'] = [
  { id: 'stage', accepts: ['video-plane'], min: 1, max: 1, region: 'spatial' },
  { id: 'logo', accepts: ['dom'], min: 0, max: 1, region: 'dom' },
  { id: 'hero-caption', accepts: ['dom'], min: 0, max: 1, region: 'dom' },
  { id: 'chapters', accepts: ['dom', 'sprite'], min: 0, max: 6, region: 'dom' },
  { id: 'outro', accepts: ['dom'], min: 0, max: 1, region: 'dom' },
];

export const SCROLL_CINEMA_LANDING_THEME_DEFAULTS: ThemeTokens = {
  colors: {
    background: '#050507',
    foreground: '#f4f2ec',
    accent: '#c9a86a',
    'caption-bg': 'rgba(5, 5, 7, 0.45)',
    'chapter-bg': 'rgba(5, 5, 7, 0.6)',
  },
  typeScale: defaultTypeScale(),
  spacing: defaultSpacing(),
  motion: {
    ...defaultMotion(),
    duration: { fast: 180, medium: 400, slow: 800 },
  },
};

/** Fade-in / hold / fade-out keyframes over a chapter's scroll window. */
function chapterWindowKeyframes(start: number, dur: number): Keyframe[] {
  const lead = dur * 0.12;
  return [
    { t: start, value: 0, easing: 'ease-out' },
    { t: start + lead, value: 1 },
    { t: start + dur - lead, value: 1 },
    { t: start + dur, value: 0, easing: 'ease-in' },
  ];
}

/** Read an optional explicit [start, end] scrollRange from a chapter's node meta. */
function chapterScrollRange(meta: Record<string, unknown> | undefined): [number, number] | undefined {
  const r = meta?.['scrollRange'];
  if (Array.isArray(r) && r.length === 2 && typeof r[0] === 'number' && typeof r[1] === 'number' && r[1] > r[0]) {
    return [r[0], r[1]];
  }
  return undefined;
}

function composeScrollCinemaLanding(cfg: EngineConfig, manifest: AssetManifest): ComposedScene {
  resetIds();
  const theme = resolveThemeTokens(SCROLL_CINEMA_LANDING_THEME_DEFAULTS, cfg.theme);
  const metaKey = SCROLL_CINEMA_LANDING_ID;

  const bySlot = (slot: string) => cfg.scenes.filter((s) => s.slot === slot);
  const stageScene = bySlot('stage')[0];
  const logoScene = bySlot('logo')[0];
  const heroScene = bySlot('hero-caption')[0];
  const chapterScenes = bySlot('chapters');
  const outroScene = bySlot('outro')[0];

  // Total scroll extent: stage range, or the sum of every scene's range.
  const rangeOf = (d: number): number => (Number.isFinite(d) && d > 0 ? d : 1);
  const totalRange =
    (stageScene ? rangeOf(stageScene.track.durationOrRange) : 0) ||
    cfg.scenes.reduce((sum, s) => sum + rangeOf(s.track.durationOrRange), 0) ||
    1;

  const tracks: TimelineTrack[] = [];
  const sceneRefs = new Map<string, SceneRefEntry>();
  const roots: SceneNode[] = [];
  const islands: string[] = [];

  // --- Stage: scrubbed video plane + scroll-driven parallax scale. ----------
  const videoRef = stageScene?.nodes.find((n) => n.kind === 'video-plane' && n.assetId);
  const videoAsset = manifestEntry(manifest, videoRef?.assetId) ?? firstAssetOfKind(manifest, 'video');
  const videoAssetId = videoRef?.assetId ?? videoAsset?.id ?? '';
  const videoDuration =
    videoAsset?.kind === 'video' && Number.isFinite(videoAsset.duration) && videoAsset.duration > 0
      ? videoAsset.duration
      : totalRange;

  const scrubTrackId = `track-${stageScene?.id ?? 'stage'}-scrub`;
  const videoNodeId = `node-${stageScene?.id ?? 'stage'}-video`;
  tracks.push(
    makeTrack(scrubTrackId, videoNodeId, 'scroll', [0, totalRange], [
      { t: 0, value: 0, easing: 'linear' },
      { t: totalRange, value: videoDuration, easing: 'linear' },
    ]),
  );

  const parallaxTrackId = `track-${stageScene?.id ?? 'stage'}-parallax`;
  tracks.push(
    makeTrack(parallaxTrackId, videoNodeId, 'scroll', [0, totalRange], [
      { t: 0, value: PARALLAX_SCALE[0], easing: 'linear' },
      { t: totalRange, value: PARALLAX_SCALE[1], easing: 'linear' },
    ]),
  );

  const videoNode = makeNode({
    id: videoNodeId,
    kind: 'video-plane',
    layer: 0,
    payload: { assetId: videoAssetId, scrubbed: true },
    bindings: [
      { trackId: scrubTrackId, property: 'playback.time', easing: 'linear' },
      { trackId: parallaxTrackId, property: 'transform.scale', easing: 'linear' },
    ],
    meta: {
      [metaKey]: {
        slot: 'stage',
        a11y: stageScene?.a11y ?? { label: 'Background video' },
        theme,
        parallaxScale: PARALLAX_SCALE,
      },
    },
  });
  roots.push(videoNode);
  if (stageScene)
    sceneRefs.set(stageScene.id, {
      nodeId: videoNodeId,
      trackId: scrubTrackId,
      range: [0, totalRange],
    });

  // --- Logo: static DOM node, always visible, no track. ---------------------
  if (logoScene) {
    const logoNode = makeNode({
      id: `node-${logoScene.id}`,
      kind: 'group',
      layer: 30,
      children: logoScene.nodes.map((nc) => ({ ...nodeFromConfig(nc, logoScene, '', 31, metaKey), bindings: [] })),
      meta: { [metaKey]: { slot: 'logo', a11y: logoScene.a11y, static: true } },
    });
    roots.push(logoNode);
    sceneRefs.set(logoScene.id, { nodeId: logoNode.id, trackId: scrubTrackId, range: [0, totalRange] });
    islands.push(logoNode.id);
  }

  // --- Hero caption: fades out over the first 15% of scroll. ----------------
  if (heroScene) {
    const trackId = `track-${heroScene.id}`;
    const groupId = `node-${heroScene.id}`;
    const fadeEnd = totalRange * HERO_CAPTION_FADE_FRACTION;
    tracks.push(
      makeTrack(trackId, groupId, 'scroll', [0, fadeEnd], [
        { t: 0, value: 1 },
        { t: fadeEnd, value: 0, easing: 'ease-in' },
      ]),
    );
    const group = makeNode({
      id: groupId,
      kind: 'group',
      layer: 20,
      bindings: [{ trackId, property: 'material.opacity' }],
      meta: {
        [metaKey]: { slot: 'hero-caption', a11y: heroScene.a11y, fadeOutRange: [0, fadeEnd] },
      },
    });
    for (const nc of heroScene.nodes) group.children.push(nodeFromConfig(nc, heroScene, trackId, 21, metaKey));
    roots.push(group);
    sceneRefs.set(heroScene.id, { nodeId: groupId, trackId, range: [0, fadeEnd] });
    islands.push(groupId);
  }

  // --- Chapters: fade-in/hold/fade-out over each window. --------------------
  // Windows default to equal slices of the middle scroll region (after the
  // hero fade, before the outro); a chapter node may override with
  // meta.scrollRange: [start, end].
  const innerStart = totalRange * HERO_CAPTION_FADE_FRACTION;
  const innerEnd = totalRange * (1 - OUTRO_FADE_FRACTION);
  const slice = chapterScenes.length > 0 ? (innerEnd - innerStart) / chapterScenes.length : 0;
  chapterScenes.forEach((scene, i) => {
    const explicit = chapterScrollRange(scene.nodes[0]?.meta);
    let [start, end] = explicit ?? [innerStart + i * slice, innerStart + (i + 1) * slice];
    // Clamp windows into the real scroll extent; degenerate/fully-outside
    // explicit ranges fall back to the computed slice.
    start = Math.min(Math.max(start, 0), totalRange);
    end = Math.min(Math.max(end, 0), totalRange);
    if (end - start <= 0) {
      start = Math.min(Math.max(innerStart + i * slice, 0), totalRange);
      end = Math.min(Math.max(innerStart + (i + 1) * slice, 0), totalRange);
    }
    const dur = end - start > 0 ? end - start : 1;
    const trackId = `track-${scene.id}`;
    const groupId = `node-${scene.id}`;
    tracks.push(makeTrack(trackId, groupId, 'scroll', [start, end], chapterWindowKeyframes(start, dur)));
    const group = makeNode({
      id: groupId,
      kind: 'group',
      layer: 10,
      bindings: [{ trackId, property: 'material.opacity' }],
      meta: { [metaKey]: { slot: 'chapters', a11y: scene.a11y, scrollRange: [start, end] } },
    });
    for (const nc of scene.nodes) group.children.push(nodeFromConfig(nc, scene, trackId, 11, metaKey));
    roots.push(group);
    sceneRefs.set(scene.id, { nodeId: groupId, trackId, range: [start, end] });
    islands.push(groupId);
  });

  // --- Outro: fades in over the last 12% of scroll. --------------------------
  if (outroScene) {
    const trackId = `track-${outroScene.id}`;
    const groupId = `node-${outroScene.id}`;
    const fadeStart = totalRange * (1 - OUTRO_FADE_FRACTION);
    tracks.push(
      makeTrack(trackId, groupId, 'scroll', [fadeStart, totalRange], [
        { t: fadeStart, value: 0, easing: 'ease-out' },
        { t: totalRange, value: 1 },
      ]),
    );
    const group = makeNode({
      id: groupId,
      kind: 'group',
      layer: 20,
      bindings: [{ trackId, property: 'material.opacity' }],
      meta: { [metaKey]: { slot: 'outro', a11y: outroScene.a11y, fadeInRange: [fadeStart, totalRange] } },
    });
    for (const nc of outroScene.nodes) group.children.push(nodeFromConfig(nc, outroScene, trackId, 21, metaKey));
    roots.push(group);
    sceneRefs.set(outroScene.id, { nodeId: groupId, trackId, range: [fadeStart, totalRange] });
    islands.push(groupId);
  }

  const bindings = resolveBindings(cfg, sceneRefs);
  return assembleScene(roots, tracks, bindings, islands, islands.length > 0);
}

export const scrollCinemaLandingTemplate: TemplateDescriptor = {
  kind: 'scroll-video',
  version: '0.1.0',
  slots: SCROLL_CINEMA_LANDING_SLOTS,
  themeTokens: SCROLL_CINEMA_LANDING_THEME_DEFAULTS,
  requiredCapabilities: {
    renderers: ['webgl2', 'canvas2d'],
    assetFeatures: ['hls'],
    interactions: ['scroll', 'touch'],
  },
  budgets: {
    jsGzBytes: 120_000,
    criticalAssetBytes: 1_800_000,
    firstFrameMs: 1_500,
  },
  compose: composeScrollCinemaLanding,
};
