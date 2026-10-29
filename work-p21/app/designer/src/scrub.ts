/**
 * @lumen/app-designer — frame-step scrubbing.
 *
 * ScrubController drives a set of engine tracks (TimelineTrack set or a full
 * ComposedScene) with deterministic seeking. evaluateAt delegates to the
 * engine's own evaluateTrack from @lumen/scene — designer previews match
 * runtime output exactly; no easing math is reimplemented here.
 *
 * Frame stepping quantizes to the 1/fps grid: stepFrames(n, fps) moves the
 * playhead by exactly n/fps and snaps the landed time onto the frame grid.
 */

import type { ComposedScene, TimelineTrack } from '@lumen/contracts';
import { evaluateTrack, type EvaluateOptions, type TrackValue } from '@lumen/scene';

/** Per-track evaluation result at one instant. */
export interface ScrubSample {
  /** Playhead time sampled (after any quantization). */
  t: number;
  /** Per-track evaluated values, keyed by track id. */
  values: Record<string, TrackValue | undefined>;
}

export interface ScrubControllerOptions {
  /** EvaluateOptions forwarded to the engine evaluator (loop mode, easing override). */
  evaluate?: EvaluateOptions;
}

export class ScrubController {
  /** Tracks being scrubbed (engine TimelineTrack shape). */
  readonly tracks: readonly TimelineTrack[];
  private playhead = 0;

  /** Accepts a ComposedScene (uses scene.tracks) or a bare track array. */
  constructor(sceneOrTracks: ComposedScene | readonly TimelineTrack[], options: ScrubControllerOptions = {}) {
    this.tracks = Array.isArray(sceneOrTracks)
      ? (sceneOrTracks as readonly TimelineTrack[])
      : (sceneOrTracks as ComposedScene).tracks;
    this.evaluateOptions = options.evaluate ?? {};
  }

  private readonly evaluateOptions: EvaluateOptions;

  /** Current playhead position. */
  get t(): number {
    return this.playhead;
  }

  /** Seek to an absolute playhead position. Returns the sampled values. */
  seek(t: number): ScrubSample {
    this.playhead = t;
    return this.sample(t);
  }

  /**
   * Step the playhead by n frames at the given fps (negative n steps back).
   * The landed time is quantized to the 1/fps frame grid so repeated
   * stepping lands exactly on frame boundaries regardless of float drift.
   */
  stepFrames(n: number, fps: number): ScrubSample {
    if (!Number.isFinite(fps) || fps <= 0) throw new Error(`invalid fps: ${fps}`);
    const frame = Math.round(this.playhead * fps) + n;
    const t = quantizeToFrame(frame / fps, fps);
    this.playhead = t;
    return this.sample(t);
  }

  /**
   * Evaluate every track at an arbitrary time (does not move the playhead).
   * Uses the engine evaluator verbatim.
   */
  evaluateAt(t: number): ScrubSample {
    return this.sample(t);
  }

  private sample(t: number): ScrubSample {
    const values: Record<string, TrackValue | undefined> = {};
    for (const track of this.tracks) {
      values[track.id] = evaluateTrack(track, t, this.evaluateOptions);
    }
    return { t, values };
  }
}

/** Snap a time to the nearest 1/fps frame boundary (frame-step accuracy). */
export function quantizeToFrame(t: number, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`invalid fps: ${fps}`);
  return Math.round(t * fps) / fps;
}
