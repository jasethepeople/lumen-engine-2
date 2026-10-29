/**
 * @lumen/templates — 'product-showcase' descriptor (kind: 'viewer-3d').
 * A specialization of the viewer-3d frontend type: a single product mesh on a
 * stage with a pointer-drag orbit (0..2π yaw) plus a time-driven auto-rotate
 * track (pausable on interaction, documented via meta), up to six DOM hotspot
 * overlays anchored in 3D space that fade in over scroll windows, an optional
 * spec-sheet DOM panel, and up to four colorway variant configs carried via
 * node meta.
 *
 * Distinct from the stock `viewer3dTemplate` by descriptor id/name (see
 * `PRODUCT_SHOWCASE_ID`), its slot set, and its `meta['product-showcase']`
 * node namespacing. TemplateKind is frozen, so `kind` stays 'viewer-3d'.
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
  normalizeScrollRange,
  resetIds,
  resolveBindings,
  type SceneRefEntry,
} from './internal.js';
import { defaultMotion, defaultSpacing, defaultTypeScale, resolveThemeTokens } from './theme.js';

/** Stable descriptor id; distinguishes this specialization from viewer3dTemplate. */
export const PRODUCT_SHOWCASE_ID = 'product-showcase';

/** Seconds for one full auto-rotate revolution (0..2π). */
export const AUTO_ROTATE_PERIOD_S = 12;
/** Default fraction of total scroll over which each hotspot fades in. */
export const HOTSPOT_FADE_FRACTION = 0.08;
/** Fraction of total scroll over which the spec-sheet fades in. */
export const SPEC_SHEET_FADE_FRACTION = 0.1;

/** Default camera framing for a product showcase stage. */
export const PRODUCT_SHOWCASE_CAMERA_DEFAULTS = {
  position: [0, 1.0, 3.0] as [number, number, number],
  fov: 40,
  near: 0.1,
  far: 100,
  target: [0, 0.5, 0] as [number, number, number],
};

export const PRODUCT_SHOWCASE_SLOTS: TemplateDescriptor['slots'] = [
  { id: 'stage', accepts: ['mesh'], min: 1, max: 1, region: 'spatial' },
  { id: 'hotspots', accepts: ['dom'], min: 0, max: 6, region: 'hybrid' },
  { id: 'spec-sheet', accepts: ['dom'], min: 0, max: 1, region: 'dom' },
  { id: 'colorways', accepts: ['dom'], min: 0, max: 4, region: 'dom' },
];

export const PRODUCT_SHOWCASE_THEME_DEFAULTS: ThemeTokens = {
  colors: {
    background: '#0d0d11',
    foreground: '#f2f2ef',
    accent: '#e0b45c',
    surface: '#15151c',
    'hotspot-bg': 'rgba(13, 13, 17, 0.82)',
    'spec-sheet-bg': 'rgba(13, 13, 17, 0.7)',
  },
  typeScale: defaultTypeScale(),
  spacing: defaultSpacing(),
  motion: {
    ...defaultMotion(),
    duration: { fast: 180, medium: 400, slow: 900 },
  },
};

/** Hotspot fade-in keyframes over a scroll window: quick ease-in, then hold. */
function hotspotFadeKeyframes(start: number, end: number): Keyframe[] {
  const lead = Math.max((end - start) * 0.35, 1e-6);
  return [
    { t: start, value: 0, easing: 'ease-out' },
    { t: start + lead, value: 1 },
    { t: end, value: 1 },
  ];
}

/**
 * Read an optional 3D anchor from a scene node's meta
 * (`meta.anchor: [x, y, z]`), used to position hotspot overlays in model
 * space. Returns undefined when absent or malformed.
 */
function anchorFromMeta(meta: Record<string, unknown> | undefined): [number, number, number] | undefined {
  const a = meta?.['anchor'];
  if (Array.isArray(a) && a.length === 3 && a.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return [a[0], a[1], a[2]];
  }
  return undefined;
}

/**
 * Read an optional explicit [start, end] scrollRange from node meta
 * (`meta.scrollRange`), clamped by callers via normalizeScrollRange.
 */
function scrollRangeFromMeta(meta: Record<string, unknown> | undefined): [number, number] | undefined {
  const r = meta?.['scrollRange'];
  if (Array.isArray(r) && r.length === 2 && typeof r[0] === 'number' && typeof r[1] === 'number' && r[1] > r[0]) {
    return [r[0], r[1]];
  }
  return undefined;
}

/**
 * Read a colorway variant config from node meta (`meta.variant`). Any plain
 * object is accepted and carried verbatim into the composed node meta for the
 * runtime to apply as a material/texture variant.
 */
function variantFromMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const v = meta?.['variant'];
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

function composeProductShowcase(cfg: EngineConfig, manifest: AssetManifest): ComposedScene {
  resetIds();
  const theme = resolveThemeTokens(PRODUCT_SHOWCASE_THEME_DEFAULTS, cfg.theme);
  const metaKey = PRODUCT_SHOWCASE_ID;

  const bySlot = (slot: string) => cfg.scenes.filter((s) => s.slot === slot);
  const stageScene = bySlot('stage')[0];
  const hotspotScenes = bySlot('hotspots');
  const specSheetScene = bySlot('spec-sheet')[0];
  const colorwayScenes = bySlot('colorways');

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

  // --- Camera with template defaults. ---------------------------------------
  const camera = makeNode({
    id: 'node-showcase-camera',
    kind: 'camera',
    layer: 0,
    transform: { position: [...PRODUCT_SHOWCASE_CAMERA_DEFAULTS.position] },
    meta: {
      [metaKey]: {
        fov: PRODUCT_SHOWCASE_CAMERA_DEFAULTS.fov,
        near: PRODUCT_SHOWCASE_CAMERA_DEFAULTS.near,
        far: PRODUCT_SHOWCASE_CAMERA_DEFAULTS.far,
        target: PRODUCT_SHOWCASE_CAMERA_DEFAULTS.target,
      },
    },
  });
  roots.push(camera);

  // --- Stage: product mesh with orbit + auto-rotate. ------------------------
  const modelRef = stageScene?.nodes.find((n) => n.kind === 'mesh' && n.assetId);
  const modelAsset = manifestEntry(manifest, modelRef?.assetId) ?? firstAssetOfKind(manifest, 'model');
  const modelAssetId = modelRef?.assetId ?? modelAsset?.id ?? '';
  const stageId = stageScene?.id ?? 'stage';
  const modelNodeId = `node-${stageId}`;

  // Orbit track: pointer drag drives yaw 0..2π over the input range.
  const orbitTrackId = `track-${stageId}-orbit`;
  tracks.push(
    makeTrack(orbitTrackId, modelNodeId, 'pointer', [0, Math.PI * 2], [
      { t: 0, value: 0, easing: 'linear' },
      { t: Math.PI * 2, value: Math.PI * 2, easing: 'linear' },
    ]),
  );

  // Auto-rotate: time-driven full revolution every AUTO_ROTATE_PERIOD_S.
  // Pause contract (meta): the runtime pauses this track's playhead while a
  // pointer/touch orbit interaction is active (`autoRotate.pauseOn`), then
  // resumes after `resumeAfterMs` of inactivity.
  const autoRotateTrackId = `track-${stageId}-autorotate`;
  tracks.push(
    makeTrack(autoRotateTrackId, modelNodeId, 'time', [0, AUTO_ROTATE_PERIOD_S], [
      { t: 0, value: 0, easing: 'linear' },
      { t: AUTO_ROTATE_PERIOD_S, value: Math.PI * 2, easing: 'linear' },
    ]),
  );

  const modelNode = makeNode({
    id: modelNodeId,
    kind: 'mesh',
    layer: 1,
    payload: { assetId: modelAssetId },
    bindings: [
      { trackId: orbitTrackId, property: 'transform.rotationQuat' },
      { trackId: orbitTrackId, property: 'transform.position' },
      { trackId: autoRotateTrackId, property: 'transform.rotationQuat' },
    ],
    meta: {
      [metaKey]: {
        slot: 'stage',
        a11y: stageScene?.a11y ?? { label: 'Product model' },
        theme,
        orbit: true,
        autoRotate: {
          trackId: autoRotateTrackId,
          periodS: AUTO_ROTATE_PERIOD_S,
          pauseOn: 'interaction',
          resumeAfterMs: 2000,
        },
      },
    },
  });
  roots.push(modelNode);
  if (stageScene)
    sceneRefs.set(stageScene.id, {
      nodeId: modelNodeId,
      trackId: orbitTrackId,
      range: [0, Math.PI * 2],
    });

  // --- Hotspots: DOM overlays anchored in 3D, fade in over scroll windows. --
  // Windows default to equal slices across the full scroll extent; a hotspot
  // node may override with meta.scrollRange: [start, end]. The 3D anchor comes
  // from meta.anchor: [x, y, z] on the scene's first node.
  const slice = hotspotScenes.length > 0 ? totalRange / hotspotScenes.length : 0;
  hotspotScenes.forEach((scene, i) => {
    const explicit = scrollRangeFromMeta(scene.nodes[0]?.meta);
    // Raw clamp+swap (epsilon=0) so degenerate explicit ranges fall back to
    // the computed slice; then enforce the minimum window width.
    let [start, end] = explicit
      ? normalizeScrollRange(explicit[0], explicit[1], totalRange, 0)
      : [i * slice, (i + 1) * slice];
    if (end - start <= 0) {
      [start, end] = normalizeScrollRange(i * slice, (i + 1) * slice, totalRange);
    }
    const trackId = `track-${scene.id}`;
    const groupId = `node-${scene.id}`;
    tracks.push(makeTrack(trackId, groupId, 'scroll', [start, end], hotspotFadeKeyframes(start, end)));
    const anchor = anchorFromMeta(scene.nodes[0]?.meta);
    const group = makeNode({
      id: groupId,
      kind: 'group',
      layer: 5,
      bindings: [{ trackId, property: 'material.opacity' }],
      meta: {
        [metaKey]: {
          slot: 'hotspots',
          a11y: scene.a11y,
          hotspotIndex: i,
          scrollRange: [start, end],
          ...(anchor !== undefined ? { anchor } : {}),
        },
      },
    });
    for (const nc of scene.nodes) {
      group.children.push(nodeFromConfig(nc, scene, trackId, 6, metaKey));
    }
    roots.push(group);
    sceneRefs.set(scene.id, { nodeId: groupId, trackId, range: [start, end] });
    islands.push(groupId);
  });

  // --- Spec-sheet: DOM panel fading in over the last stretch of scroll. -----
  if (specSheetScene) {
    const explicit = scrollRangeFromMeta(specSheetScene.nodes[0]?.meta);
    const defaultStart = totalRange * (1 - SPEC_SHEET_FADE_FRACTION);
    const [start, end] = explicit
      ? normalizeScrollRange(explicit[0], explicit[1], totalRange)
      : normalizeScrollRange(defaultStart, totalRange, totalRange);
    const trackId = `track-${specSheetScene.id}`;
    const groupId = `node-${specSheetScene.id}`;
    tracks.push(
      makeTrack(trackId, groupId, 'scroll', [start, end], [
        { t: start, value: 0, easing: 'ease-out' },
        { t: end, value: 1 },
      ]),
    );
    const group = makeNode({
      id: groupId,
      kind: 'group',
      layer: 10,
      bindings: [{ trackId, property: 'material.opacity' }],
      meta: {
        [metaKey]: {
          slot: 'spec-sheet',
          a11y: specSheetScene.a11y,
          fadeInRange: [start, end],
        },
      },
    });
    for (const nc of specSheetScene.nodes) {
      group.children.push(nodeFromConfig(nc, specSheetScene, trackId, 11, metaKey));
    }
    roots.push(group);
    sceneRefs.set(specSheetScene.id, { nodeId: groupId, trackId, range: [start, end] });
    islands.push(groupId);
  }

  // --- Colorways: static DOM swatch nodes carrying variant configs. ---------
  // No track: variants are applied imperatively by the runtime from
  // meta['product-showcase'].variant on each swatch node (carried verbatim
  // from the config node's meta.variant).
  for (const scene of colorwayScenes) {
    const groupId = `node-${scene.id}`;
    const group = makeNode({
      id: groupId,
      kind: 'group',
      layer: 20,
      meta: { [metaKey]: { slot: 'colorways', a11y: scene.a11y, static: true } },
    });
    for (const nc of scene.nodes) {
      const variant = variantFromMeta(nc.meta);
      const node = { ...nodeFromConfig(nc, scene, orbitTrackId, 21, metaKey), bindings: [] };
      node.meta = {
        ...(node.meta ?? {}),
        [metaKey]: {
          ...((node.meta?.[metaKey] as Record<string, unknown> | undefined) ?? {}),
          ...(variant !== undefined ? { variant } : {}),
        },
      };
      group.children.push(node);
    }
    roots.push(group);
    sceneRefs.set(scene.id, { nodeId: groupId, trackId: orbitTrackId, range: [0, Math.PI * 2] });
    islands.push(groupId);
  }

  const bindings = resolveBindings(cfg, sceneRefs);
  return assembleScene(roots, tracks, bindings, islands, islands.length > 0);
}

export const productShowcaseTemplate: TemplateDescriptor = {
  kind: 'viewer-3d',
  version: '0.1.0',
  slots: PRODUCT_SHOWCASE_SLOTS,
  themeTokens: PRODUCT_SHOWCASE_THEME_DEFAULTS,
  requiredCapabilities: {
    renderers: ['webgl2', 'dom'],
    assetFeatures: ['draco', 'ktx2'],
    interactions: ['pointer', 'touch', 'scroll'],
  },
  budgets: {
    jsGzBytes: 220_000,
    criticalAssetBytes: 3_000_000,
    firstFrameMs: 2_500,
  },
  compose: composeProductShowcase,
};
