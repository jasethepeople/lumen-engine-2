/**
 * @lumen/runtime — scroll-scrub wiring.
 *
 * Scroll templates bind a scroll-driven track to a video-plane node's
 * `playback.time` pseudo-property. That path is not a real SceneNode
 * property (the scene layer cannot apply it), so the runtime handles it as
 * a first-class binding: each frame, the resolved playhead value is routed
 * to the loaded video asset's `seekTo()` — throttled so a fast scroller
 * does not flood the decoder.
 */

import type { EngineError, SceneNode, VideoPayload } from '@lumen/contracts';
import type { SceneRuntime } from '@lumen/scene';
import type { AssetManager } from '@lumen/assets';

/** One video-plane node wired to a scrub track. */
export interface ScrubTarget {
  nodeId: string;
  assetId: string;
  trackId: string;
}

/** Binding path treated as "video playback position in seconds". */
export const SCRUB_PROPERTY = 'playback.time';

/**
 * Walk the scene graph and collect video-plane nodes that carry a
 * `playback.time` binding and are marked scrubbed.
 */
export function collectScrubTargets(scene: SceneRuntime): ScrubTarget[] {
  const targets: ScrubTarget[] = [];
  const visit = (node: SceneNode): void => {
    if (node.kind === 'video-plane' && node.payload) {
      const payload = node.payload as VideoPayload;
      if (payload.scrubbed === false) {
        // free playback — not scrub-wired
      } else if (typeof payload.assetId === 'string' && payload.assetId !== '') {
        const binding = node.bindings.find((b) => b.property === SCRUB_PROPERTY);
        if (binding) targets.push({ nodeId: node.id, assetId: payload.assetId, trackId: binding.trackId });
      }
    }
    for (const child of node.children) visit(child);
  };
  for (const root of scene.graph.roots) visit(root);
  return targets;
}

export interface ScrubberOptions {
  /** Asset source: resolved handles provide LoadedVideo.seekTo. */
  assets: AssetManager;
  /** Error sink — wire to the kernel bus as engine:error. */
  onError: (err: EngineError) => void;
  /** Minimum milliseconds between seeks per target (default 120). */
  minIntervalMs?: number;
  /** Minimum seconds of playback drift before a seek is issued (default 1/30). */
  epsilon?: number;
  /** Clock override (testing). */
  now?: () => number;
}

export interface Scrubber {
  /** Route current playhead values to video seekTo() (throttled). */
  update(playheads: ReadonlyMap<string, number>, targets: readonly ScrubTarget[]): void;
  /** Forget per-target throttle state. */
  dispose(): void;
}

/**
 * Create the frame-loop scrubber. Seeks are fire-and-forget: seek failures
 * (stalled element, missing asset) are reported once per target burst via
 * onError and never reject the frame loop.
 */
export function createScrubber(options: ScrubberOptions): Scrubber {
  const minIntervalMs = options.minIntervalMs ?? 120;
  const epsilon = options.epsilon ?? 1 / 30;
  const now = options.now ?? (() => performance.now());
  const last = new Map<string, { value: number; at: number }>();

  return {
    update(playheads, targets) {
      const t = now();
      for (const target of targets) {
        const raw = playheads.get(target.trackId);
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) continue;
        const prev = last.get(target.trackId);
        if (prev && Math.abs(raw - prev.value) < epsilon) continue;
        if (prev && t - prev.at < minIntervalMs) continue;
        last.set(target.trackId, { value: raw, at: t });
        const handle = options.assets.get(target.assetId);
        if (!handle || handle.kind !== 'video') continue; // not loaded (yet)
        handle.video.seekTo(raw).catch((cause: unknown) => {
          options.onError({
            module: 'runtime',
            code: 'SCRUB_SEEK_FAILED',
            recoverable: true,
            cause,
          });
        });
      }
    },
    dispose() {
      last.clear();
    },
  };
}
