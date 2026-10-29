/**
 * @lumen/interaction — virtual scroller.
 *
 * Implements the frozen `VirtualScroller` contract: raw wheel/touch scroll
 * deltas are consumed into a smoothed, clamped virtual playhead. The mapping is
 * frame-deterministic: `feedDelta()` accumulates raw input; `update(dt)`
 * advances the smoothed progress exactly once per frame, so timeline scrubbing
 * is consistent across browsers and input devices.
 */

import type { VirtualScroller } from '@lumen/contracts';

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
  private readonly onProgress?: (p: number) => void;
  private detachFns: Array<() => void> = [];

  constructor(opts: VirtualScrollerOptions = {}) {
    this.smoothing = opts.smoothing ?? 0.12;
    this.wheelMultiplier = opts.wheelMultiplier ?? 1;
    this.snapPoints = opts.snap ? [...opts.snap].sort((a, b) => a - b) : [];
    this.snapThreshold = opts.snapThreshold ?? 0.02;
    this.reducedMotion = opts.reducedMotion ?? false;
    this.onProgress = opts.onProgress;
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
    if (on) this.current = this.target;
  }

  setSnapPoints(points: number[]): void {
    this.snapPoints = [...points].sort((a, b) => a - b);
  }

  /**
   * Consume a raw scroll delta (in progress units; positive = scroll down).
   * No-op while disabled. Applied to the target; smoothing happens in update().
   */
  feedDelta(deltaProgress: number): void {
    if (!this.enabled) return;
    this.target = clamp01(this.target + deltaProgress * this.wheelMultiplier);
    if (this.reducedMotion) {
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
    if (!this.reducedMotion) {
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
      }
    }
    if (this.current !== prev) this.onProgress?.(this.current);
    return this.current;
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
    if (opts?.animate === false || this.reducedMotion) {
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
      if (!this.enabled) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      const p = clamp01(el.scrollTop / max);
      this.target = p;
      if (this.reducedMotion) {
        this.current = p;
        this.onProgress?.(p);
      }
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
