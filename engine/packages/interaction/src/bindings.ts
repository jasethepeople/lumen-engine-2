/**
 * @lumen/interaction — binding runtime.
 *
 * Maps gesture/scroll input state onto scalar values that drive
 * (targetNodeId, targetTrackId) pairs in the scene graph.
 *
 * HANDSHAKE with @lumen/scene: each frame the InteractionManager produces a
 * driver map `{ [trackId: string]: number }` — the mapped (and smoothed,
 * snapped) timeline scalar in seconds. The Scene agent's `evaluate()` consumes
 * this map through its `drivers` parameter; keys are TimelineTrack.id values.
 *
 * a11yFallback handling:
 * - 'steps': output quantized to the snap points (or inputRange endpoints) and
 *   exposed to keyboard step navigation by the manager.
 * - 'static': output pinned at outputRange[0]; no input processing.
 * - 'native-video': binding deactivated (the template renders a native video
 *   control instead); output pinned at outputRange[0].
 */

import type { A11yFallback, GestureType, InteractionBinding } from '@lumen/contracts';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Linear mapping curve from input domain to output range, clamped. */
export function mapInputToOutput(
  value: number,
  inputRange: [number, number],
  outputRange: [number, number],
): number {
  const [i0, i1] = inputRange;
  const [o0, o1] = outputRange;
  const t = i1 === i0 ? 0 : (value - i0) / (i1 - i0);
  return o0 + clamp(t, 0, 1) * (o1 - o0);
}

/** Snap a value to the nearest snap point within `threshold` (in output units). */
export function snapValue(value: number, snap: number[] | undefined, threshold: number): number {
  if (!snap || snap.length === 0) return value;
  let best = value;
  let bestDist = threshold;
  for (const s of snap) {
    const d = Math.abs(s - value);
    if (d <= bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/** Whether a binding is deactivated by its a11y fallback under reduced motion. */
export function isStaticFallback(fallback: A11yFallback): boolean {
  return fallback === 'static' || fallback === 'native-video';
}

/** Ordered discrete step values for a 'steps' fallback binding. */
export function stepValues(binding: InteractionBinding): number[] {
  const [o0, o1] = binding.mapping.outputRange;
  const snap = binding.mapping.snap;
  if (snap && snap.length > 0) {
    return [...new Set([o0, ...snap, o1])].sort((a, b) => a - b);
  }
  return [o0, (o0 + o1) / 2, o1];
}

interface SmoothState {
  value: number;
  velocity: number;
}

/**
 * Runtime for a single InteractionBinding. Feed input values (scroll progress,
 * accumulated pan delta, pinch scale…); read the mapped scalar each frame.
 */
export class BindingRuntime {
  readonly binding: InteractionBinding;
  private smooth: SmoothState;
  private rawTarget: number;
  private lastOutput: number;
  private stepIndex = 0;

  constructor(binding: InteractionBinding) {
    this.binding = binding;
    const start = binding.mapping.outputRange[0];
    this.smooth = { value: start, velocity: 0 };
    this.rawTarget = start;
    this.lastOutput = start;
  }

  /** Feed a new raw input value in the binding's input domain. */
  feedInput(value: number): void {
    if (isStaticFallback(this.binding.a11yFallback)) return;
    this.rawTarget = mapInputToOutput(value, this.binding.mapping.inputRange, this.binding.mapping.outputRange);
  }

  /** Advance smoothing and return the current driver scalar (seconds). */
  update(dt: number, reducedMotion: boolean): number {
    const { mapping, a11yFallback } = this.binding;
    if (isStaticFallback(a11yFallback)) {
      this.lastOutput = mapping.outputRange[0];
      return this.lastOutput;
    }

    let target = this.rawTarget;
    if (a11yFallback === 'steps' && reducedMotion) {
      // Quantize to discrete, keyboard-reachable steps.
      const steps = stepValues(this.binding);
      target = steps.reduce((acc, s) => (Math.abs(s - this.rawTarget) < Math.abs(acc - this.rawTarget) ? s : acc), steps[0]);
      this.smooth.value = target;
      this.smooth.velocity = 0;
    } else if (target !== this.lastOutput && mapping.snap) {
      target = snapValue(target, mapping.snap, Math.abs(mapping.outputRange[1] - mapping.outputRange[0]) * 0.02);
    }

    const smoothing = mapping.smoothing;
    if (!smoothing || reducedMotion) {
      this.smooth.value = target;
      this.smooth.velocity = 0;
    } else if (smoothing.type === 'lerp') {
      const frames = Math.max(dt, 0) * 60;
      const alpha = 1 - Math.pow(1 - clamp(smoothing.factor, 0, 1), frames);
      this.smooth.value += (target - this.smooth.value) * alpha;
      if (Math.abs(target - this.smooth.value) < 1e-4) this.smooth.value = target;
    } else {
      // Critically-damped-ish spring heuristic; factor acts as stiffness.
      const k = clamp(smoothing.factor, 0.01, 1) * 40;
      const dts = Math.max(dt, 0);
      const accel = (target - this.smooth.value) * k - this.smooth.velocity * 2 * Math.sqrt(k);
      this.smooth.velocity += accel * dts;
      this.smooth.value += this.smooth.velocity * dts;
      if (Math.abs(target - this.smooth.value) < 1e-4 && Math.abs(this.smooth.velocity) < 1e-3) {
        this.smooth.value = target;
        this.smooth.velocity = 0;
      }
    }

    const [o0, o1] = mapping.outputRange;
    this.lastOutput = clamp(this.smooth.value, Math.min(o0, o1), Math.max(o0, o1));
    return this.lastOutput;
  }

  /** Current driver scalar without advancing state. */
  get output(): number {
    return this.lastOutput;
  }

  // ---- Keyboard / steps navigation (a11y 'steps' fallback) ----

  /** Jump to the next discrete step. Returns the new output value. */
  stepNext(): number {
    return this.stepBy(1);
  }

  /** Jump to the previous discrete step. Returns the new output value. */
  stepPrev(): number {
    return this.stepBy(-1);
  }

  private stepBy(dir: 1 | -1): number {
    const steps = stepValues(this.binding);
    const nearest = steps.findIndex((s) => Math.abs(s - this.lastOutput) < 1e-6);
    this.stepIndex = clamp((nearest === -1 ? this.stepIndex : nearest) + dir, 0, steps.length - 1);
    this.rawTarget = steps[this.stepIndex];
    this.smooth.value = this.rawTarget;
    this.smooth.velocity = 0;
    this.lastOutput = this.rawTarget;
    return this.lastOutput;
  }

  /** Whether this binding is gesture-driven and matches the gesture type. */
  matchesGesture(type: GestureType): boolean {
    return this.binding.gesture === type;
  }
}
