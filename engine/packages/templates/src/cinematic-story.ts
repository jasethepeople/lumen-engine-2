/**
 * @lumen/templates — 'cinematic-story' descriptor (kind: 'cinematic-spa').
 * A specialization of the cinematic-spa frontend type: single-page cinematic
 * storytelling on a TIME clock — an optional title card, 2–8 sequenced acts
 * with 1.2s crossfade overlap, an optional score, and optional credits.
 * Keyboard navigation (scene:next / scene:prev bus events) is resolved from
 * declarative keyboard interactions.
 *
 * Transition model: acts run on overlapping time windows; each act's opacity
 * track fades in over the first 1.2s of its window and fades out over the last
 * 1.2s, so consecutive acts crossfade. Under reduced motion the runtime cuts
 * instantly: all keyframes here use easing 'linear' and every act node carries
 * meta['cinematic-story'].reducedMotion = { transition: 'cut', easing: 'linear' }
 * to signal the runtime to skip interpolation entirely.
 *
 * Distinct from the stock `cinematicSpaTemplate` by descriptor id/name (see
 * `CINEMATIC_STORY_ID`), its slot set, and its meta namespacing. TemplateKind
 * is frozen, so `kind` stays 'cinematic-spa'.
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

/** Stable descriptor id; distinguishes this specialization from cinematicSpaTemplate. */
export const CINEMATIC_STORY_ID = 'cinematic-story';

/** Title card hold time in seconds (overridable via the title-card scene's track). */
export const TITLE_CARD_DURATION_S = 3;
/** Crossfade overlap between consecutive acts, in seconds. */
export const CROSSFADE_S = 1.2;

export const CINEMATIC_STORY_SLOTS: TemplateDescriptor['slots'] = [
  { id: 'title-card', accepts: ['dom'], min: 0, max: 1, region: 'dom' },
  { id: 'acts', accepts: ['dom', 'sprite', 'mesh', 'video-plane'], min: 2, max: 8, region: 'hybrid' },
  { id: 'score', accepts: ['dom'], min: 0, max: 1, region: 'dom' },
  { id: 'credits', accepts: ['dom'], min: 0, max: 1, region: 'dom' },
];

export const CINEMATIC_STORY_THEME_DEFAULTS: ThemeTokens = {
  colors: {
    background: '#08080c',
    foreground: '#efece4',
    accent: '#b0874f',
    surface: '#12121a',
    'caption-bg': 'rgba(8, 8, 12, 0.55)',
  },
  typeScale: defaultTypeScale(),
  spacing: defaultSpacing(),
  motion: {
    ...defaultMotion(),
    duration: { fast: 200, medium: 500, slow: 1200 },
  },
};

/**
 * Crossfade keyframes over an act's window: fade in over the first `xfade`
 * seconds, hold, fade out over the last `xfade`. Easings are linear so that
 * reduced-motion runtimes can treat them as instant cuts without curve
 * mismatch; the `reducedMotion` meta flag tells the runtime to snap values.
 */
function crossfadeKeyframes(start: number, dur: number, xfade: number): Keyframe[] {
  const f = Math.min(xfade, dur / 2);
  return [
    { t: start, value: 0, easing: 'linear' },
    { t: start + f, value: 1, easing: 'linear' },
    { t: start + dur - f, value: 1, easing: 'linear' },
    { t: start + dur, value: 0, easing: 'linear' },
  ];
}

/** Per-act duration hint from any node's meta.durationHint (seconds). */
function durationHint(scene: { nodes: { meta?: Record<string, unknown> }[] }): number | undefined {
  for (const n of scene.nodes) {
    const hint = n.meta?.['durationHint'];
    if (typeof hint === 'number' && hint > 0) return hint;
  }
  return undefined;
}

function composeCinematicStory(cfg: EngineConfig, manifest: AssetManifest): ComposedScene {
  resetIds();
  const theme = resolveThemeTokens(CINEMATIC_STORY_THEME_DEFAULTS, cfg.theme);
  const metaKey = CINEMATIC_STORY_ID;

  const bySlot = (slot: string) => cfg.scenes.filter((s) => s.slot === slot);
  const titleScene = bySlot('title-card')[0];
  const actScenes = bySlot('acts');
  const scoreScene = bySlot('score')[0];
  const creditsScene = bySlot('credits')[0];

  const tracks: TimelineTrack[] = [];
  const sceneRefs = new Map<string, SceneRefEntry>();
  const roots: SceneNode[] = [];
  const islands: string[] = [];
  let clock = 0;

  const addScene = (
    scene: NonNullable<typeof titleScene>,
    slot: string,
    dur: number,
    layer: number,
    extraMeta: Record<string, unknown>,
  ): { groupId: string; trackId: string } => {
    const trackId = `track-${scene.id}`;
    const groupId = `node-${scene.id}`;
    tracks.push(makeTrack(trackId, groupId, 'time', [clock, clock + dur], crossfadeKeyframes(clock, dur, CROSSFADE_S)));
    const group = makeNode({
      id: groupId,
      kind: 'group',
      layer,
      bindings: [{ trackId, property: 'material.opacity' }],
      meta: {
        [metaKey]: {
          slot,
          a11y: scene.a11y,
          theme,
          sequenceStart: clock,
          sequenceEnd: clock + dur,
          transition: 'crossfade',
          // Reduced motion: runtime replaces crossfades with instant cuts.
          reducedMotion: { transition: 'cut', easing: 'linear' },
          ...extraMeta,
        },
      },
    });
    for (const nc of scene.nodes) {
      const missing =
        (nc.kind === 'mesh' || nc.kind === 'sprite' || nc.kind === 'video-plane') &&
        nc.assetId !== undefined &&
        !manifest.assets[nc.assetId];
      const cfgNode = missing
        ? { ...nc, meta: { ...(nc.meta ?? {}), [metaKey]: { missingAsset: true } } }
        : nc;
      group.children.push(nodeFromConfig(cfgNode, scene, trackId, layer + 1, metaKey));
    }
    roots.push(group);
    sceneRefs.set(scene.id, { nodeId: groupId, trackId, range: [clock, clock + dur] });
    if (scene.nodes.some((n) => n.kind === 'dom')) islands.push(groupId);
    return { groupId, trackId };
  };

  // --- Title card: 3s hold, crossfades into the first act. ------------------
  if (titleScene) {
    const dur = titleScene.track.durationOrRange || TITLE_CARD_DURATION_S;
    addScene(titleScene, 'title-card', dur, 10, { role: 'title-card' });
    clock += dur - CROSSFADE_S; // next scene overlaps the fade-out
  }

  // --- Acts: sequenced with 1.2s crossfade overlap. --------------------------
  actScenes.forEach((scene, i) => {
    // durationOrRange of 0/negative/NaN must not corrupt the global clock —
    // floor every act at 0.1s (crossfade math stays well-defined).
    const raw = durationHint(scene) ?? scene.track.durationOrRange ?? 6;
    const dur = Number.isFinite(raw) && raw > 0.1 ? raw : 0.1;
    addScene(scene, 'acts', dur, 5, { actIndex: i, durationHint: dur });
    clock = Math.max(0, clock + dur - CROSSFADE_S);
  });

  // --- Credits: follow the final act. ---------------------------------------
  if (creditsScene) {
    const dur = creditsScene.track.durationOrRange || 4;
    addScene(creditsScene, 'credits', dur, 10, { role: 'credits' });
    clock += dur;
  } else if (actScenes.length > 0) {
    clock += CROSSFADE_S; // close out the final act's fade
  }

  // --- Score: a silent DOM carrier node referencing an audio asset. ---------
  if (scoreScene) {
    const assetRef = scoreScene.nodes.find((n) => typeof n.meta?.['assetId'] === 'string');
    const audioAsset =
      manifestEntry(manifest, assetRef?.meta?.['assetId'] as string | undefined) ??
      firstAssetOfKind(manifest, 'audio');
    const scoreNode = makeNode({
      id: `node-${scoreScene.id}`,
      kind: 'dom',
      layer: 1,
      payload: { html: scoreScene.nodes[0]?.html ?? '' },
      meta: {
        [metaKey]: {
          slot: 'score',
          a11y: scoreScene.a11y,
          assetId: audioAsset?.id ?? (assetRef?.meta?.['assetId'] as string | undefined) ?? '',
          autoplay: true,
          loop: false,
          totalDuration: clock,
        },
      },
    });
    roots.push(scoreNode);
    sceneRefs.set(scoreScene.id, { nodeId: scoreNode.id, trackId: tracks[0]?.id ?? '' });
  }

  // Navigation contract: keyboard interactions authored in config resolve (via
  // resolveBindings) onto the current act's track; the runtime maps onNavigate
  // to the 'scene:next' / 'scene:prev' event-bus topics that advance/retreat
  // the time clock between act windows.
  const bindings = resolveBindings(cfg, sceneRefs);
  return assembleScene(roots, tracks, bindings, islands, islands.length > 0);
}

export const cinematicStoryTemplate: TemplateDescriptor = {
  kind: 'cinematic-spa',
  version: '0.1.0',
  slots: CINEMATIC_STORY_SLOTS,
  themeTokens: CINEMATIC_STORY_THEME_DEFAULTS,
  requiredCapabilities: {
    renderers: ['webgl2', 'dom'],
    assetFeatures: ['hls'],
    interactions: ['keyboard', 'pointer', 'scroll'],
  },
  budgets: {
    jsGzBytes: 160_000,
    criticalAssetBytes: 2_000_000,
    firstFrameMs: 2_000,
  },
  compose: composeCinematicStory,
};
