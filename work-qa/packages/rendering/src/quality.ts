/**
 * Adaptive quality controller.
 *
 * Consumes FrameStats from the scheduler, tracks an exponential moving
 * average of frame time, and steps a discrete quality ladder down when the
 * EMA exceeds the frame budget or up when there is sustained headroom.
 * Hysteresis (separate up/down thresholds) plus a cooldown between steps
 * prevents oscillation around the threshold.
 */

import type { FrameStats, QualityLevel } from '@lumen/contracts';

export interface AdaptiveQualityOptions {
  /** Frame budget in ms (e.g. 16.7 for 60fps, 33.3 for 30fps). Default 16.7. */
  budgetMs?: number;
  /** EMA smoothing factor 0..1; higher reacts faster. Default 0.2. */
  emaAlpha?: number;
  /** Minimum ms between quality steps. Default 500. */
  cooldownMs?: number;
  /** EMA must exceed budgetMs * upStepThreshold to step down. Default 1.0. */
  downThreshold?: number;
  /** EMA must stay below budgetMs * upThreshold to step up. Default 0.7. */
  upThreshold?: number;
  /** Number of consecutive headroom evaluations required before stepping up. Default 3. */
  upStreakRequired?: number;
  /** Clamp for the dprScale ladder. Default [0.5, 2.0]. */
  dprScaleBounds?: [number, number];
  /** Optional cap on dprScale from the CapabilityProfile dpr envelope. */
  maxDpr?: number;
}

/** Discrete rung on the quality ladder. */
interface QualityRung {
  dprScale: number;
  msaa: 0 | 2 | 4 | 8;
  shadowMapSize?: number;
}

const LADDER: readonly QualityRung[] = [
  { dprScale: 0.5, msaa: 0, shadowMapSize: 256 },
  { dprScale: 0.75, msaa: 0, shadowMapSize: 512 },
  { dprScale: 1.0, msaa: 2, shadowMapSize: 1024 },
  { dprScale: 1.25, msaa: 4, shadowMapSize: 1024 },
  { dprScale: 1.5, msaa: 4, shadowMapSize: 2048 },
  { dprScale: 2.0, msaa: 8, shadowMapSize: 2048 },
];

export class AdaptiveQualityController {
  private readonly budgetMs: number;
  private readonly emaAlpha: number;
  private readonly cooldownMs: number;
  private readonly downThreshold: number;
  private readonly upThreshold: number;
  private readonly upStreakRequired: number;
  private readonly allPostPasses: string[];

  private rungIndex: number;
  private emaMs: number | null = null;
  private lastStepAt = 0;
  private headroomStreak = 0;

  constructor(opts: AdaptiveQualityOptions = {}, initialPostPasses: string[] = []) {
    this.budgetMs = opts.budgetMs ?? 16.7;
    this.emaAlpha = opts.emaAlpha ?? 0.2;
    this.cooldownMs = opts.cooldownMs ?? 500;
    this.downThreshold = opts.downThreshold ?? 1.0;
    this.upThreshold = opts.upThreshold ?? 0.7;
    this.upStreakRequired = opts.upStreakRequired ?? 3;
    this.allPostPasses = [...initialPostPasses];

    const [minScale, maxScale] = opts.dprScaleBounds ?? [0.5, 2.0];
    const cap = Math.min(maxScale, opts.maxDpr ?? maxScale);
    const lo = Math.max(0, LADDER.findIndex((r) => r.dprScale >= minScale));
    const hiRaw = findLastIndex(LADDER, (r) => r.dprScale <= cap);
    const hi = hiRaw >= lo ? hiRaw : lo;
    // Start at the top of the allowed window; the controller steps down fast
    // if the device cannot sustain it.
    this.rungIndex = hi;
    this.minRung = lo;
    this.maxRung = hi;
  }

  private readonly minRung: number;
  private readonly maxRung: number;

  /** Feed one frame's stats; returns true when the quality level changed. */
  update(stats: FrameStats, nowMs: number = now()): boolean {
    const frameMs = Math.max(stats.cpuMs, stats.gpuMsEstimate);
    this.emaMs = this.emaMs === null ? frameMs : this.emaAlpha * frameMs + (1 - this.emaAlpha) * this.emaMs;

    const overBudget = this.emaMs > this.budgetMs * this.downThreshold || stats.overBudget;
    const headroom = this.emaMs < this.budgetMs * this.upThreshold;

    if (overBudget) {
      this.headroomStreak = 0;
      if (this.rungIndex > this.minRung && nowMs - this.lastStepAt >= this.cooldownMs) {
        this.rungIndex -= 1;
        this.lastStepAt = nowMs;
        return true;
      }
      return false;
    }

    if (headroom) {
      this.headroomStreak += 1;
      if (
        this.headroomStreak >= this.upStreakRequired &&
        this.rungIndex < this.maxRung &&
        nowMs - this.lastStepAt >= this.cooldownMs
      ) {
        this.rungIndex += 1;
        this.headroomStreak = 0;
        this.lastStepAt = nowMs;
        return true;
      }
    } else {
      this.headroomStreak = 0;
    }
    return false;
  }

  /** Current quality directives for IRenderer.setQuality. */
  getLevel(): QualityLevel {
    const rung = LADDER[this.rungIndex] ?? LADDER[0]!;
    // Post passes shed first on the two lowest rungs, then all are enabled.
    const postPasses = this.rungIndex <= this.minRung ? [] : this.rungIndex === this.minRung + 1 ? this.allPostPasses.slice(0, 1) : [...this.allPostPasses];
    const level: QualityLevel = { dprScale: rung.dprScale, msaa: rung.msaa, postPasses };
    if (rung.shadowMapSize !== undefined) level.shadowMapSize = rung.shadowMapSize;
    return level;
  }

  /** Current EMA frame time in ms (null before the first update). */
  get emaFrameMs(): number | null {
    return this.emaMs;
  }

  /** Current ladder position (0 = lowest fidelity), for diagnostics. */
  get rung(): number {
    return this.rungIndex;
  }

  reset(): void {
    this.emaMs = null;
    this.headroomStreak = 0;
    this.lastStepAt = 0;
    this.rungIndex = this.maxRung;
  }
}

function findLastIndex<T>(arr: readonly T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (pred(arr[i]!)) return i;
  }
  return -1;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
