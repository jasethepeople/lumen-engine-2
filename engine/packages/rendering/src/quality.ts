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
  /**
   * P13: base ladder to expand (or use verbatim). Default: the expanded
   * single-axis ladder generated from {@link LADDER_V1}. Pass `LADDER_V1`
   * to restore the legacy 6-rung behavior exactly.
   */
  ladder?: readonly QualityRung[];
}

/** Discrete rung on the quality ladder (P13: decoupled axes). */
export interface QualityRung {
  dprScale: number;
  msaa: 0 | 2 | 4 | 8;
  shadowMapSize?: number;
  /**
   * Number of post passes kept (prefix of the configured pass list).
   * `Infinity` keeps all configured passes.
   */
  postKeep: number;
}

/**
 * The legacy 6-rung ladder (phase-3 behavior), exported as a preset so
 * embedders can restore old behavior via `AdaptiveQualityOptions.ladder`.
 * With the default dpr window its `getLevel()` outputs are identical to the
 * historical index-based shedding (lowest rung sheds all post passes, the
 * next keeps one, the rest keep all).
 */
export const LADDER_V1: readonly QualityRung[] = [
  { dprScale: 0.5, msaa: 0, shadowMapSize: 256, postKeep: 0 },
  { dprScale: 0.75, msaa: 0, shadowMapSize: 512, postKeep: 1 },
  { dprScale: 1.0, msaa: 2, shadowMapSize: 1024, postKeep: Infinity },
  { dprScale: 1.25, msaa: 4, shadowMapSize: 1024, postKeep: Infinity },
  { dprScale: 1.5, msaa: 4, shadowMapSize: 2048, postKeep: Infinity },
  { dprScale: 2.0, msaa: 8, shadowMapSize: 2048, postKeep: Infinity },
];

/** Standard MSAA descent steps, high → low. */
const MSAA_STEPS: readonly (0 | 2 | 4 | 8)[] = [8, 4, 2, 0];

function postCount(rung: QualityRung, configured: number): number {
  return rung.postKeep === Infinity ? configured : Math.min(rung.postKeep, configured);
}

/**
 * P13: expand a base ladder into a single-axis ladder. Between each adjacent
 * pair of base rungs, intermediate rungs shed exactly one axis at a time in
 * shed order: post passes (right-to-left, one per rung) → MSAA ↓ → shadow
 * map ↓; the dpr step lands on the lower base rung itself. The base rungs
 * remain as a subsequence of the result. `configuredPostPasses` resolves
 * `postKeep: Infinity` ("keep all"); the controller passes the length of its
 * configured pass list.
 */
export function buildLadder(
  base: readonly QualityRung[] = LADDER_V1,
  configuredPostPasses = 0,
): readonly QualityRung[] {
  // The base ladder is ordered low → high fidelity. For each adjacent pair
  // (lo, hi) we compute the intermediate shed rungs top-down (post → msaa →
  // shadow; the dpr step lands on `lo` itself), then emit them reversed so
  // consecutive rungs in the output still differ in exactly one axis.
  const out: QualityRung[] = [];
  for (let i = 0; i < base.length; i += 1) {
    const lo = base[i]!;
    const hi = base[i + 1];
    out.push(lo);
    if (hi === undefined) break;
    const shed: QualityRung[] = [];
    const hiPost = postCount(hi, configuredPostPasses);
    const loPost = Math.min(postCount(lo, configuredPostPasses), hiPost);
    // 1. Post passes, one rung per dropped pass (right-to-left).
    for (let k = hiPost - 1; k >= loPost; k -= 1) {
      shed.push({ dprScale: hi.dprScale, msaa: hi.msaa, shadowMapSize: hi.shadowMapSize, postKeep: k });
    }
    // 2. MSAA, one step per rung down to the lower rung's value
    //    (dpr/shadow held at the higher rung).
    const hiMi = MSAA_STEPS.indexOf(hi.msaa);
    const loMi = MSAA_STEPS.indexOf(lo.msaa);
    if (hiMi !== -1 && loMi !== -1) {
      for (let m = hiMi + 1; m <= loMi; m += 1) {
        shed.push({ dprScale: hi.dprScale, msaa: MSAA_STEPS[m]!, shadowMapSize: hi.shadowMapSize, postKeep: loPost });
      }
    }
    // 3. Shadow map, halving per rung down to the lower rung's value
    //    (dpr held, msaa now at lower value); the dpr step then lands on
    //    `lo` changing exactly one axis.
    if (hi.shadowMapSize !== undefined && lo.shadowMapSize !== undefined && hi.shadowMapSize > lo.shadowMapSize) {
      for (let s = hi.shadowMapSize / 2; s > lo.shadowMapSize; s /= 2) {
        shed.push({ dprScale: hi.dprScale, msaa: lo.msaa, shadowMapSize: s, postKeep: loPost });
      }
      shed.push({ dprScale: hi.dprScale, msaa: lo.msaa, shadowMapSize: lo.shadowMapSize, postKeep: loPost });
    }
    for (let k = shed.length - 1; k >= 0; k -= 1) out.push(shed[k]!);
  }
  return out;
}

export class AdaptiveQualityController {
  private readonly budgetMs: number;
  private readonly emaAlpha: number;
  private readonly cooldownMs: number;
  private readonly downThreshold: number;
  private readonly upThreshold: number;
  private readonly upStreakRequired: number;
  private readonly allPostPasses: string[];
  private readonly ladder: readonly QualityRung[];

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
    // P13: a provided base ladder is used verbatim (preset escape hatch);
    // otherwise the default base ladder expands into single-axis rungs.
    this.ladder = opts.ladder ?? buildLadder(LADDER_V1, this.allPostPasses.length);

    const [minScale, maxScale] = opts.dprScaleBounds ?? [0.5, 2.0];
    const cap = Math.min(maxScale, opts.maxDpr ?? maxScale);
    const lo = Math.max(0, this.ladder.findIndex((r) => r.dprScale >= minScale));
    // Top of the window: the LAST rung within the dpr cap. Expanded ladders
    // hold dpr across consecutive shed rungs ordered shed → base, so the
    // last match is the full-fidelity base rung of the top allowed dpr group
    // (identical to legacy behavior on single-dpr ladders like LADDER_V1).
    const hiRaw = findLastIndex(this.ladder, (r) => r.dprScale <= cap);
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
    const rung = this.ladder[this.rungIndex] ?? this.ladder[0]!;
    // P13: post passes shed one at a time via the rung's postKeep count.
    const postPasses = this.allPostPasses.slice(0, postCount(rung, this.allPostPasses.length));
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
