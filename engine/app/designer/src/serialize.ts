/**
 * @lumen/app-designer — serialization.
 *
 * timelineToConfig / configToTimeline convert between the designer document
 * model and the exact track/segments/smoothing JSON shapes the engine
 * accepts: TimelineTrack (lowered verbatim into SceneIR tracks by codegen)
 * and SceneConfig (validated by @lumen/config parseConfig).
 *
 * Round-trip fidelity contract:
 *   configToTimeline(x) -> timelineToConfig(d) deep-equals x
 * for any well-formed input. Designer keyframe ids are editor-only and are
 * stripped on serialization (regenerated on load).
 */

import type {
  CubicBezier,
  EngineConfig,
  Keyframe,
  SceneConfig,
  TimelineTrack,
} from '@lumen/contracts';
import {
  createTimelineDocument,
  nextKeyframeId,
  type TimelineDocument,
} from './timeline.js';

/** Serialization output: the SceneConfig entry plus the full track JSON. */
export interface TimelineConfigOutput {
  /**
   * SceneConfig entry for the track's scene. The scene-level `track` field
   * carries only {driver, durationOrRange} per the frozen config schema;
   * keyframes/segments/smoothing live on `track` below.
   */
  scene: SceneConfig;
  /**
   * The exact TimelineTrack JSON the engine consumes (codegen lowers this
   * shape verbatim into SceneIR.tracks / IRTrack).
   */
  track: TimelineTrack;
}

/** Input accepted by configToTimeline: a TimelineConfigOutput, an object
 *  with a `track` field, or a bare TimelineTrack JSON. */
export type TimelineConfigInput = TimelineTrack | { scene?: SceneConfig; track: TimelineTrack };

export interface TimelineToConfigOptions {
  /** SlotDefinition.id the scene targets (default 'main'). */
  slot?: string;
  /** Accessibility label (default: scene id). */
  label?: string;
  /** Accessibility summary. */
  summary?: string;
  /** Declarative nodes placed in the scene slot (default: target node id as a group). */
  nodes?: SceneConfig['nodes'];
}

/** Convert a designer document into the engine track JSON (id-stripped). */
export function timelineDocToTrack(doc: TimelineDocument): TimelineTrack {
  const track: TimelineTrack = {
    id: doc.id,
    target: doc.target,
    keyframes: doc.keyframes.map(stripKeyframeId),
    driver: doc.driver,
    range: [doc.range[0], doc.range[1]],
  };
  if (doc.motion !== undefined) track.motion = doc.motion;
  if (doc.smoothing !== undefined) track.smoothing = { ...doc.smoothing };
  if (doc.segments.length > 0) {
    track.segments = doc.segments.map((seg) => ({
      id: seg.id,
      from: seg.from,
      to: seg.to,
      keys: seg.keys.map((k) => ({ ...k })),
    }));
  }
  return track;
}

/**
 * Serialize a designer document into config-ready JSON. `scene` validates
 * against the frozen EngineConfig schema (embed it into a full config and
 * run parseConfig); `track` is the verbatim engine track shape.
 */
export function timelineToConfig(
  doc: TimelineDocument,
  options: TimelineToConfigOptions = {},
): TimelineConfigOutput {
  const track = timelineDocToTrack(doc);
  const scene: SceneConfig = {
    id: doc.sceneId,
    slot: options.slot ?? 'main',
    nodes: options.nodes ?? [],
    track: {
      driver: doc.driver,
      durationOrRange: doc.range[1] - doc.range[0],
    },
    a11y: {
      label: options.label ?? doc.sceneId,
      ...(options.summary !== undefined ? { summary: options.summary } : {}),
      ...(doc.motion !== undefined ? { motion: doc.motion } : {}),
    },
  };
  return { scene, track };
}

/** Load engine JSON into a designer document (fresh keyframe ids). */
export function configToTimeline(input: TimelineConfigInput): TimelineDocument {
  const track: TimelineTrack = 'track' in input && !isTimelineTrack(input)
    ? (input as { track: TimelineTrack }).track
    : (input as TimelineTrack);
  const scene: SceneConfig | undefined =
    'scene' in input && !isTimelineTrack(input)
      ? (input as { scene?: SceneConfig }).scene
      : undefined;

  if (!track || typeof track.id !== 'string' || !Array.isArray(track.keyframes)) {
    throw new Error('configToTimeline: malformed track JSON');
  }

  return createTimelineDocument({
    id: track.id,
    sceneId: scene?.id ?? track.id,
    target: track.target,
    driver: track.driver,
    range: [track.range[0], track.range[1]],
    keyframes: (track.keyframes ?? []).map((k) => ({ ...cloneKeyframe(k), id: nextKeyframeId() })),
    segments: (track.segments ?? []).map((seg) => ({
      id: seg.id,
      from: seg.from,
      to: seg.to,
      keys: seg.keys.map(cloneKeyframe),
    })),
    smoothing: track.smoothing ? { ...track.smoothing } : undefined,
    motion: track.motion ?? scene?.a11y.motion,
  });
}

/** Build a minimal but fully valid EngineConfig wrapping serialized scenes —
 *  convenience for previews/tests; the result passes parseConfig as-is. */
export function wrapInEngineConfig(
  outputs: readonly TimelineConfigOutput[],
  base: Omit<EngineConfig, 'scenes'>,
): EngineConfig {
  return { ...base, scenes: outputs.map((o) => o.scene) };
}

function isTimelineTrack(input: unknown): input is TimelineTrack {
  return (
    typeof input === 'object' &&
    input !== null &&
    Array.isArray((input as TimelineTrack).keyframes) &&
    typeof (input as TimelineTrack).target === 'string'
  );
}

function stripKeyframeId(key: Keyframe & { id?: string }): Keyframe {
  const { id: _id, ...rest } = key;
  return { ...rest };
}

function cloneKeyframe(key: Keyframe): Keyframe {
  const out: Keyframe = { t: key.t, value: Array.isArray(key.value) ? [...key.value] : key.value };
  if (key.easing !== undefined) out.easing = key.easing;
  if (key.easingBezier !== undefined) out.easingBezier = [...key.easingBezier] as CubicBezier;
  return out;
}
