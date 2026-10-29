/**
 * @lumen/app-designer — easing curve library.
 *
 * Named easings reuse the engine's frozen EasingName set; bezier presets use
 * the engine's CubicBezier convention ([x1, y1, x2, y2], CSS cubic-bezier,
 * x components clamped to [0, 1]) and evaluate via @lumen/scene so the
 * designer preview matches runtime output byte-for-byte.
 */

import type { CubicBezier, EasingName } from '@lumen/contracts';
import { applyEasing, cubicBezierEase } from '@lumen/scene';

/** One entry in the designer easing library. */
export interface EasingPreset {
  /** Library identifier (unique within EASING_LIBRARY). */
  id: string;
  /** Human label for the curve picker. */
  label: string;
  /** Engine easing: a frozen EasingName or cubic-bezier control points. */
  easing: EasingName | CubicBezier;
}

/** Engine named easings (frozen contract set). */
export const NAMED_EASING_NAMES: readonly EasingName[] = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step',
];

/**
 * Designer easing library: all engine named easings plus common cubic-bezier
 * presets (CSS-compatible control points).
 */
export const EASING_LIBRARY: readonly EasingPreset[] = [
  { id: 'linear', label: 'Linear', easing: 'linear' },
  { id: 'ease-in', label: 'Ease In (quad)', easing: 'ease-in' },
  { id: 'ease-out', label: 'Ease Out (quad)', easing: 'ease-out' },
  { id: 'ease-in-out', label: 'Ease In Out (quad)', easing: 'ease-in-out' },
  { id: 'step', label: 'Step', easing: 'step' },
  { id: 'bezier-ease', label: 'Ease (CSS)', easing: [0.25, 0.1, 0.25, 1] },
  { id: 'bezier-ease-in-cubic', label: 'Ease In (cubic)', easing: [0.55, 0.06, 0.68, 0.19] },
  { id: 'bezier-ease-out-cubic', label: 'Ease Out (cubic)', easing: [0.22, 0.61, 0.36, 1] },
  { id: 'bezier-ease-in-out-cubic', label: 'Ease In Out (cubic)', easing: [0.65, 0, 0.35, 1] },
  { id: 'bezier-overshoot', label: 'Overshoot (back-out)', easing: [0.34, 1.56, 0.64, 1] },
  { id: 'bezier-snap', label: 'Snap (anticipate)', easing: [0.5, -0.28, 0.74, 0.05] },
];

/** Type guard: is this easing value a cubic-bezier (vs a named easing)? */
export function isBezierEasing(easing: unknown): easing is CubicBezier {
  return Array.isArray(easing);
}

/**
 * Validate cubic-bezier control points against the engine convention:
 * exactly 4 finite numbers, x1/x2 within [0, 1] (y may overshoot).
 */
export function isValidBezier(bezier: unknown): bezier is CubicBezier {
  if (!Array.isArray(bezier) || bezier.length !== 4) return false;
  const [x1, y1, x2, y2] = bezier as number[];
  for (const n of [x1, y1, x2, y2]) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  }
  return x1! >= 0 && x1! <= 1 && x2! >= 0 && x2! <= 1;
}

/** Validate an easing value (named or bezier). */
export function isValidEasing(easing: unknown): easing is EasingName | CubicBezier {
  if (typeof easing === 'string') return (NAMED_EASING_NAMES as readonly string[]).includes(easing);
  return isValidBezier(easing);
}

/** Look up a library preset by id. */
export function getEasingPreset(id: string): EasingPreset | undefined {
  return EASING_LIBRARY.find((p) => p.id === id);
}

/**
 * Evaluate an easing at normalized progress t in [0, 1] using the engine's
 * own evaluator (designer preview == runtime output).
 */
export function evaluateEasing(easing: EasingName | CubicBezier, t: number): number {
  return applyEasing(easing, t);
}

/** Narrow an unknown value to a valid easing, or return undefined. */
export function asEasing(value: unknown): EasingName | CubicBezier | undefined {
  return isValidEasing(value) ? value : undefined;
}

/** Re-exported so UI code can sample curves without a second dependency. */
export { cubicBezierEase };
