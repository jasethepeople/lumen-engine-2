/**
 * @lumen/interaction — virtual scroller.
 *
 * Implements the frozen `VirtualScroller` contract: raw wheel/touch scroll
 * deltas are consumed into a smoothed, clamped virtual playhead. The mapping is
 * frame-deterministic: `feedDelta()` accumulates raw input; `update(dt)`
 * advances the smoothed progress exactly once per frame, so timeline scrubbing
 * is consistent across browsers and input devices.
 */

import type { MotionPolicy, VirtualScroller } from '@lumen/contracts';

export interface VirtualScrollerOptions {
  /** Lerp factor per 60fps frame (0–1). Higher = snappier. Default 0.12. */
  smoothing?: number;
  /** Multiplier applied to raw wheel deltas. Default 1. */
  wheelMultiplier?: number;
  /** Snap points in progress space (0–1). Progress settles on the nearest point. */
  snap?: number[];
  /** Max distance from a snap point for snapping to engage. Default 0.02. */
  snapThreshold?: number;
  /** When true (prefers-reduced-motion), progress jumps instantly. */
  reducedMotion?: boolean;
  /**
   * P1: engine-owned motion policy. When supplied it supersedes the raw
   * `reducedMotion` boolean: 'reveal'/'static' delegate the legacy fast
   * paths to `policy.interpolate` (instant cuts; 'reveal' additionally
   * steps to snap boundaries). Absent ⇒ legacy boolean behavior, untouched.
   */
  motion?: MotionPolicy;
  /**
   * P9: when set (and `history`/`popstate` exist), settled progress is
   * persisted via `history.replaceState` (throttled to one write per 500 ms)
   * and restored on `popstate` through the same normalized write seam.
   * Absent ⇒ no history interaction (legacy behavior).
   */
  restorationKey?: string;
  /** Called whenever smoothed progress changes during update(). */
  onProgress?: (progress: number) => void;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class LumenVirtualScroller implements VirtualScroller {
  private target = 0; // raw accumulated target progress, 0–1
  private current = 0; // smoothed progress, 0–1
  private enabled = true;
  private readonly smoothing: number;
  private readonly wheelMultiplier: number;
  private snapPoints: number[];
  private readonly snapThreshold: number;
  private reducedMotion: boolean;
  private readonly policy?: MotionPolicy;
  private readonly onProgress?: (p: number) => void;
  private readonly restorationKey?: string;
  private lastRestorationWriteAt = -Infinity;
  private detachFns: Array<() => void> = [];

  constructor(opts: VirtualScrollerOptions = {}) {
    this.smoothing = opts.smoothing ?? 0.12;
    this.wheelMultiplier = opts.wheelMultiplier ?? 1;
    this.snapPoints = opts.snap ? [...opts.snap].sort((a, b) => a - b) : [];
    this.snapThreshold = opts.snapThreshold ?? 0.02;
    this.reducedMotion = opts.reducedMotion ?? false;
    this.policy = opts.motion;
    this.onProgress = opts.onProgress;
    this.restorationKey = opts.restorationKey;
    if (this.restorationKey !== undefined && typeof window !== 'undefined' && typeof history !== 'undefined') {
      const onPopState = (ev: PopStateEvent) => {
        const saved = (ev.state as { lumenScroll?: Record<string, unknown> } | null)?.lumenScroll?.[
          this.restorationKey!
        ];
        if (typeof saved === 'number') {
          // Re-feed through the single write seam; update() republishes via
          // onProgress next frame (instantly under reduced motion).
          this.setTargetFromNormalized(saved);
        }
      };
      window.addEventListener('popstate', onPopState);
      this.detachFns.push(() => window.removeEventListener('popstate', onPopState));
    }
  }

  /** Effective reduced-motion flag: policy mode wins when a policy is injected. */
  private get reduced(): boolean {
    return this.policy ? this.policy.mode !== 'continuous' : this.reducedMotion;
  }

  get progress(): number {
    return this.current;
  }

  /** Raw (unsmoothed) target — useful for tests and determinism checks. */
  get targetProgress(): number {
    return this.target;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    if (this.reduced) this.current = this.target;
  }

  setSnapPoints(points: number[]): void {
    this.snapPoints = [...points].sort((a, b) => a - b);
  }

  /**
   * P9: single entry for ALL absolute progress writes (native scroll,
   * history restoration). Converges with feedDelta on identical state
   * transitions: same clamp, same reduced-motion fast path.
   */
  setTargetFromNormalized(p: number): void {
    if (!this.enabled) return;
    this.target = clamp01(p);
    if (this.reduced) {
      this.current = this.target;
      this.onProgress?.(this.current);
    }
  }

  /**
   * Consume a raw scroll delta (in progress units; positive = scroll down).
   * No-op while disabled. Applied to the target; smoothing happens in update().
   */
  feedDelta(deltaProgress: number): void {
    if (!this.enabled) return;
    this.target = clamp01(this.target + deltaProgress * this.wheelMultiplier);
    if (this.reduced) {
      this.current = this.target;
      this.onProgress?.(this.current);
    }
  }

  /**
   * Advance the smoothed playhead. Call exactly once per frame from the Kernel
   * scheduler. `dt` is in seconds; lerp is frame-rate compensated against a
   * 60fps baseline.
   */
  update(dt: number): number {
    const prev = this.current;
    if (this.policy && this.policy.mode === 'reveal' && this.snapPoints.length > 0) {
      // P1: reveal steps scroll progress to snap boundaries (state changes only).
      this.target = this.policy.quantizeScrub(this.target, this.snapPoints);
    }
    if (!this.reduced) {
      const frames = Math.max(dt, 0) * 60;
      const alpha = 1 - Math.pow(1 - this.smoothing, frames);
      this.current += (this.target - this.current) * alpha;
      // Settle: snap or converge when close enough.
      if (Math.abs(this.target - this.current) < 1e-4) {
        this.current = this.target;
        const snapped = this.nearestSnap(this.target);
        if (snapped !== undefined) {
          this.target = snapped;
          this.current = snapped;
        }
        this.persistForRestoration();
      }
    } else if (this.policy) {
      // Policy-driven cut (reveal/static): identical to the legacy jump but
      // owned by the MotionPolicy so all clamp sites agree.
      this.current = this.policy.interpolate(this.current, this.target, 1);
    }
    if (this.current !== prev) this.onProgress?.(this.current);
    return this.current;
  }

  /**
   * P9: persist settled progress for history restoration, at most once per
   * 500 ms; a no-op without a restorationKey or history global.
   */
  private persistForRestoration(): void {
    if (this.restorationKey === undefined) return;
    if (typeof window === 'undefined' || typeof history === 'undefined') return;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowMs - this.lastRestorationWriteAt < 500) return;
    this.lastRestorationWriteAt = nowMs;
    try {
      const state = (history.state ?? {}) as Record<string, unknown>;
      const lumenScroll = { ...((state.lumenScroll as Record<string, number> | undefined) ?? {}) };
      lumenScroll[this.restorationKey] = this.current;
      history.replaceState({ ...state, lumenScroll }, '');
    } catch {
      // History APIs can throw (opaque origins, quota); restoration is best-effort.
    }
  }

  private nearestSnap(p: number): number | undefined {
    let best: number | undefined;
    let bestDist = this.snapThreshold;
    for (const s of this.snapPoints) {
      const d = Math.abs(s - p);
      if (d <= bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best;
  }

  seek(p: number, opts?: { animate?: boolean }): void {
    const target = clamp01(p);
    this.target = target;
    if (opts?.animate === false || this.reduced) {
      this.current = target;
      this.onProgress?.(this.current);
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /**
   * Attach to a scroll container. Browser-only; guarded no-op without a DOM.
   * Uses native scroll position of the element (scrollTop / scrollable height)
   * as the raw input source.
   */
  attach(el: HTMLElement): void {
    if (typeof window === 'undefined') return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      // P9: native scroll converges on the same write seam as feedDelta.
      this.setTargetFromNormalized(clamp01(el.scrollTop / max));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    this.detachFns.push(() => el.removeEventListener('scroll', onScroll));
  }

  /** Detach DOM listeners. */
  detach(): void {
    for (const f of this.detachFns) f();
    this.detachFns = [];
  }
}
