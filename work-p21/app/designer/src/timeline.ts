/**
 * @lumen/app-designer — timeline editor model.
 *
 * TimelineDocument is the designer-side model of one engine TimelineTrack
 * (per scene/track). Keyframes carry designer ids; all other fields mirror
 * the engine contract shapes (Keyframe, TrackSegment, TrackSmoothing,
 * MotionMode) so documents serialize losslessly into config/IR JSON.
 *
 * TimelineEditor wraps a document with undoable editing operations; every
 * mutating call pushes an UndoStack snapshot first.
 */

import type {
  CubicBezier,
  EasingName,
  Keyframe,
  MotionMode,
  TimelineTrack,
  TrackSmoothing,
  TrackSegment,
} from '@lumen/contracts';
import { UndoStack } from './undo.js';
import { isValidBezier, isValidEasing } from './easing.js';

/** Designer keyframe: engine Keyframe plus a stable editor id. */
export interface TimelineKeyframe extends Keyframe {
  /** Unique keyframe id within the document. */
  id: string;
}

/** The designer-side document for one timeline track. */
export interface TimelineDocument {
  /** TimelineTrack.id this document edits. */
  id: string;
  /** SceneConfig.id owning the track. */
  sceneId: string;
  /** Default SceneNode.id target (TimelineTrack.target). */
  target: string;
  /** What advances the playhead. */
  driver: TimelineTrack['driver'];
  /** Playable range: seconds (time/playback) or scroll units (scroll/pointer). */
  range: [number, number];
  /** Sparse keyframes, kept sorted by t (ties broken by insertion order). */
  keyframes: TimelineKeyframe[];
  /** Reusable keyframe segments (engine TrackSegment shape, P15). */
  segments: TrackSegment[];
  /** Driver-level interpolation policy (P15); absent = global smoothing. */
  smoothing?: TrackSmoothing;
  /** Per-track reduced-motion override; absent = inherit scene/default. */
  motion?: MotionMode;
}

/** Options accepted by createTimelineDocument. */
export interface TimelineDocumentOptions {
  id: string;
  sceneId: string;
  target: string;
  driver?: TimelineTrack['driver'];
  range?: [number, number];
  keyframes?: TimelineKeyframe[];
  segments?: TrackSegment[];
  smoothing?: TrackSmoothing;
  motion?: MotionMode;
}

/** Create an empty (or seeded) timeline document. */
export function createTimelineDocument(options: TimelineDocumentOptions): TimelineDocument {
  const doc: TimelineDocument = {
    id: options.id,
    sceneId: options.sceneId,
    target: options.target,
    driver: options.driver ?? 'time',
    range: options.range ? [...options.range] : [0, 1],
    keyframes: (options.keyframes ?? []).map((k) => ({ ...k })),
    segments: (options.segments ?? []).map((s) => ({ ...s, keys: s.keys.map((k) => ({ ...k })) })),
  };
  if (options.smoothing) doc.smoothing = { ...options.smoothing };
  if (options.motion) doc.motion = options.motion;
  sortKeyframes(doc.keyframes);
  return doc;
}

/**
 * Camera track lanes (P17): position + zoom keyframe lanes for one camera
 * SceneNode. Position keys hold [x, y] (or [x, y, z]) arrays; zoom keys hold
 * scalars. Both lanes are independent TimelineDocuments.
 */
export function createCameraTrackLanes(
  cameraNodeId: string,
  options: { sceneId: string; driver?: TimelineTrack['driver']; range?: [number, number] },
): { position: TimelineDocument; zoom: TimelineDocument } {
  const base = { sceneId: options.sceneId, driver: options.driver, range: options.range };
  return {
    position: createTimelineDocument({
      ...base,
      id: `${cameraNodeId}.position`,
      target: cameraNodeId,
    }),
    zoom: createTimelineDocument({
      ...base,
      id: `${cameraNodeId}.zoom`,
      target: cameraNodeId,
    }),
  };
}

let keyframeSeq = 0;

/** Monotonic designer keyframe id (collision-free within a session). */
export function nextKeyframeId(prefix = 'kf'): string {
  keyframeSeq += 1;
  return `${prefix}-${keyframeSeq}`;
}

/**
 * Timeline editor: undoable operations over a TimelineDocument.
 * All mutating operations return true on success and record history; no-ops
 * and invalid operations return false and leave the document untouched.
 */
export class TimelineEditor {
  /** Live document (mutated in place). */
  readonly doc: TimelineDocument;
  /** Edit history (cap 100 by default). */
  readonly undo: UndoStack<TimelineDocument>;

  constructor(doc: TimelineDocument, options: { undoCap?: number } = {}) {
    this.doc = doc;
    this.undo = new UndoStack<TimelineDocument>({ cap: options.undoCap ?? 100 });
  }

  /** Add a keyframe (id assigned when absent). Keeps keyframes sorted by t. */
  addKeyframe(key: Omit<TimelineKeyframe, 'id'> & { id?: string }): TimelineKeyframe {
    const entry: TimelineKeyframe = { ...key, id: key.id ?? nextKeyframeId() };
    if (this.doc.keyframes.some((k) => k.id === entry.id)) {
      throw new Error(`duplicate keyframe id: ${entry.id}`);
    }
    if (entry.easing !== undefined && !isValidEasing(entry.easing)) {
      throw new Error(`invalid easing: ${JSON.stringify(entry.easing)}`);
    }
    if (entry.easingBezier !== undefined && !isValidBezier(entry.easingBezier)) {
      throw new Error(`invalid easingBezier: ${JSON.stringify(entry.easingBezier)}`);
    }
    this.snapshot();
    this.doc.keyframes.push(entry);
    sortKeyframes(this.doc.keyframes);
    return entry;
  }

  /** Move a keyframe to a new time (optionally changing its value). */
  moveKeyframe(id: string, t: number, value?: TimelineKeyframe['value']): boolean {
    const key = this.findKeyframe(id);
    if (!key) return false;
    this.snapshot();
    key.t = t;
    if (value !== undefined) key.value = value;
    sortKeyframes(this.doc.keyframes);
    return true;
  }

  /** Remove a keyframe by id. */
  removeKeyframe(id: string): boolean {
    const index = this.doc.keyframes.findIndex((k) => k.id === id);
    if (index < 0) return false;
    this.snapshot();
    this.doc.keyframes.splice(index, 1);
    return true;
  }

  /**
   * Set the easing applied from a keyframe to the next. Accepts an engine
   * named easing or cubic-bezier control points; bezier values are written
   * to Keyframe.easingBezier (which beats `easing` at evaluation time).
   * Pass undefined to clear both.
   */
  setEasing(id: string, easing: EasingName | CubicBezier | undefined): boolean {
    const key = this.findKeyframe(id);
    if (!key) return false;
    if (easing !== undefined && !isValidEasing(easing)) {
      throw new Error(`invalid easing: ${JSON.stringify(easing)}`);
    }
    this.snapshot();
    if (easing === undefined) {
      delete key.easing;
      delete key.easingBezier;
    } else if (Array.isArray(easing)) {
      key.easingBezier = [...easing] as CubicBezier;
      delete key.easing;
    } else {
      key.easing = easing;
      delete key.easingBezier;
    }
    return true;
  }

  /** Set (or clear) the driver-level track smoothing policy (P15). */
  setSmoothing(smoothing: TrackSmoothing | undefined): void {
    this.snapshot();
    if (smoothing === undefined) delete this.doc.smoothing;
    else this.doc.smoothing = { ...smoothing };
  }

  /** Set (or clear) the per-track reduced-motion override. */
  setMotionMode(motion: MotionMode | undefined): void {
    this.snapshot();
    if (motion === undefined) delete this.doc.motion;
    else this.doc.motion = motion;
  }

  /** Move the playable range. */
  setRange(range: [number, number]): void {
    this.snapshot();
    this.doc.range = [...range];
  }

  // -- Track segment CRUD (engine TrackSegment shape) ----------------------

  /** Add a segment. Segment key t values are local (0..1 within the window). */
  addSegment(segment: TrackSegment): TrackSegment {
    if (this.doc.segments.some((s) => s.id === segment.id)) {
      throw new Error(`duplicate segment id: ${segment.id}`);
    }
    this.snapshot();
    const copy: TrackSegment = { ...segment, keys: segment.keys.map((k) => ({ ...k })) };
    this.doc.segments.push(copy);
    return copy;
  }

  /** Move/resize a segment window. */
  moveSegment(id: string, from: number, to: number): boolean {
    const seg = this.doc.segments.find((s) => s.id === id);
    if (!seg) return false;
    this.snapshot();
    seg.from = from;
    seg.to = to;
    return true;
  }

  /** Replace a segment's local keys (engine Keyframe shape, local t 0..1). */
  setSegmentKeys(id: string, keys: Keyframe[]): boolean {
    const seg = this.doc.segments.find((s) => s.id === id);
    if (!seg) return false;
    this.snapshot();
    seg.keys = keys.map((k) => ({ ...k }));
    return true;
  }

  /** Remove a segment by id. */
  removeSegment(id: string): boolean {
    const index = this.doc.segments.findIndex((s) => s.id === id);
    if (index < 0) return false;
    this.snapshot();
    this.doc.segments.splice(index, 1);
    return true;
  }

  // -- History --------------------------------------------------------------

  /** Undo the last operation. Returns false when history is empty. */
  undoOnce(): boolean {
    const restored = this.undo.undo(this.doc);
    if (restored === undefined) return false;
    this.replaceDoc(restored);
    return true;
  }

  /** Redo the last undone operation. Returns false when the redo lane is empty. */
  redoOnce(): boolean {
    const restored = this.undo.redo(this.doc);
    if (restored === undefined) return false;
    this.replaceDoc(restored);
    return true;
  }

  private findKeyframe(id: string): TimelineKeyframe | undefined {
    return this.doc.keyframes.find((k) => k.id === id);
  }

  private snapshot(): void {
    this.undo.push(this.doc);
  }

  private replaceDoc(next: TimelineDocument): void {
    const target = this.doc as unknown as Record<string, unknown>;
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, next);
  }
}

/** Stable sort by t (insertion order preserved on ties). */
function sortKeyframes(keys: TimelineKeyframe[]): void {
  keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => a.key.t - b.key.t || a.index - b.index)
    .forEach((entry, i) => {
      keys[i] = entry.key;
    });
}
