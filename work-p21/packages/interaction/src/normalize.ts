/**
 * @lumen/interaction — input normalization.
 *
 * Converts raw DOM events (wheel, pointer*, touch*, keyboard, deviceorientation)
 * into `NormalizedInputEvent`s in a unified coordinate space: all positions and
 * deltas are viewport-normalized (0–1), timestamps are DOMHighResTimeStamp (ms).
 *
 * The core math is DOM-free and unit-testable; DOM listener wiring lives behind
 * `InputNormalizer.attach()` / `detach()` with environment guards.
 */

import type { InputSource, NormalizedInputEvent, Vec2 } from '@lumen/contracts';

/** Zero vector constant (do not mutate). */
const ZERO: Vec2 = [0, 0];

/**
 * Local adapter: the frozen contract's NormalizedInputEvent has no event phase,
 * which gesture recognizers need. `PointerSample` extends it with lifecycle
 * info. (Contract gap noted in README.)
 */
export interface PointerSample extends NormalizedInputEvent {
  /** Pointer lifecycle phase. */
  phase: 'start' | 'move' | 'end' | 'cancel';
  /** DOM pointerId for multi-touch tracking. */
  pointerId: number;
}

/** Options for {@link normalizeDelta}. */
export interface NormalizeOptions {
  /** Viewport size in px used to normalize coordinates. */
  viewport: Vec2;
  /** Multiplier applied to wheel deltas (lines vs pixels compensation etc.). */
  wheelMultiplier?: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Normalize a pixel coordinate to viewport units (0–1), clamped. */
export function normalizePosition(clientX: number, clientY: number, viewport: Vec2): Vec2 {
  const [w, h] = viewport;
  return [clamp01(w > 0 ? clientX / w : 0), clamp01(h > 0 ? clientY / h : 0)];
}

/** Normalize a pixel delta to viewport units. */
export function normalizeDelta(dx: number, dy: number, viewport: Vec2): Vec2 {
  const [w, h] = viewport;
  return [w > 0 ? dx / w : 0, h > 0 ? dy / h : 0];
}

/**
 * Estimate velocity (viewport units / second) from a delta and elapsed ms.
 * Returns ZERO when dt is non-positive.
 */
export function estimateVelocity(delta: Vec2, dtMs: number): Vec2 {
  if (dtMs <= 0) return [ZERO[0], ZERO[1]];
  const s = 1000 / dtMs;
  return [delta[0] * s, delta[1] * s];
}

interface VelocityTracker {
  lastPosition: Vec2;
  lastTimestamp: number;
  velocity: Vec2;
}

/** Smooth velocity tracker with exponential decay (per input source/pointer). */
export function createVelocityTracker(): {
  push(position: Vec2, timestamp: number): Vec2;
  reset(): void;
} {
  let state: VelocityTracker | undefined;
  return {
    push(position, timestamp) {
      if (!state) {
        state = { lastPosition: position, lastTimestamp: timestamp, velocity: [0, 0] };
        return [0, 0];
      }
      const dt = timestamp - state.lastTimestamp;
      const raw = estimateVelocity(
        [position[0] - state.lastPosition[0], position[1] - state.lastPosition[1]],
        dt,
      );
      // Exponential smoothing to de-jitter velocity.
      const alpha = dt > 0 && dt < 100 ? 0.4 : 0.2;
      state.velocity = [
        state.velocity[0] + (raw[0] - state.velocity[0]) * alpha,
        state.velocity[1] + (raw[1] - state.velocity[1]) * alpha,
      ];
      state.lastPosition = position;
      state.lastTimestamp = timestamp;
      return [state.velocity[0], state.velocity[1]];
    },
    reset() {
      state = undefined;
    },
  };
}

/** Build a fully-formed NormalizedInputEvent from parts. */
export function makeEvent(
  source: InputSource,
  timestamp: number,
  position: Vec2,
  delta: Vec2,
  velocity: Vec2,
  modifiers: { shift: boolean; ctrl: boolean; alt: boolean } = { shift: false, ctrl: false, alt: false },
): NormalizedInputEvent {
  return {
    source,
    timestamp,
    position: [position[0], position[1]],
    delta: [delta[0], delta[1]],
    velocity: [velocity[0], velocity[1]],
    modifiers: { ...modifiers },
  };
}

type DOMEventMap = {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

const mods = (e: DOMEventMap): { shift: boolean; ctrl: boolean; alt: boolean } => ({
  shift: e.shiftKey,
  ctrl: e.ctrlKey,
  alt: e.altKey,
});

export type NormalizedEventHandler = (event: NormalizedInputEvent) => void;
export type PointerSampleHandler = (sample: PointerSample) => void;

/**
 * Wires DOM listeners and emits normalized events. Browser-only: `attach()` is
 * a no-op outside a DOM environment. All continuous listeners are passive.
 */
export class InputNormalizer {
  private root: HTMLElement | undefined;
  private viewport: Vec2 = [1, 1];
  private wheelMultiplier: number;
  private cleanups: Array<() => void> = [];
  private trackers = new Map<number, ReturnType<typeof createVelocityTracker>>();
  private scrollTracker = createVelocityTracker();

  onEvent: NormalizedEventHandler | undefined;
  onPointer: PointerSampleHandler | undefined;

  constructor(opts: { wheelMultiplier?: number } = {}) {
    this.wheelMultiplier = opts.wheelMultiplier ?? 1;
  }

  /** Current viewport in px (updated on attach/resize). */
  get viewportSize(): Vec2 {
    return [this.viewport[0], this.viewport[1]];
  }

  attach(root: HTMLElement): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (this.root) this.detach();
    this.root = root;
    this.viewport = [window.innerWidth || 1, window.innerHeight || 1];

    const listen = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
      passive = true,
    ) => {
      target.addEventListener(type, handler as EventListener, { passive });
      this.cleanups.push(() => target.removeEventListener(type, handler as EventListener));
    };

    listen(window, 'resize', () => {
      this.viewport = [window.innerWidth || 1, window.innerHeight || 1];
    });

    // Wheel: deltaMode 1 = lines (≈16px), 2 = pages (≈viewport height).
    listen(root, 'wheel', (e: WheelEvent) => {
      const modeScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.viewport[1] : 1;
      const delta = normalizeDelta(
        e.deltaX * modeScale * this.wheelMultiplier,
        e.deltaY * modeScale * this.wheelMultiplier,
        this.viewport,
      );
      const pos = normalizePosition(e.clientX, e.clientY, this.viewport);
      const vel = this.scrollTracker.push(pos, e.timeStamp);
      this.onEvent?.(makeEvent('scroll', e.timeStamp, pos, delta, vel, mods(e)));
    });

    const pointer = (phase: PointerSample['phase']) => (e: PointerEvent) => {
      const pos = normalizePosition(e.clientX, e.clientY, this.viewport);
      let tracker = this.trackers.get(e.pointerId);
      if (!tracker || phase === 'start') {
        tracker = createVelocityTracker();
        this.trackers.set(e.pointerId, tracker);
      }
      const velocity = tracker.push(pos, e.timeStamp);
      const delta: Vec2 = phase === 'move' ? [velocity[0] * 0.016, velocity[1] * 0.016] : [0, 0];
      const base = makeEvent(e.pointerType === 'touch' ? 'touch' : 'pointer', e.timeStamp, pos, delta, velocity, mods(e));
      const sample: PointerSample = { ...base, phase, pointerId: e.pointerId };
      this.onPointer?.(sample);
      if (phase === 'end' || phase === 'cancel') this.trackers.delete(e.pointerId);
    };
    listen(root, 'pointerdown', pointer('start'));
    listen(root, 'pointermove', pointer('move'));
    listen(root, 'pointerup', pointer('end'));
    listen(root, 'pointercancel', pointer('cancel'));

    // Touch: pointer events do not feed the virtual scroller, so map vertical
    // drags onto scroll deltas here. delta is raw finger movement (positive =
    // finger moved down = scroll up); the manager negates it when feeding the
    // scroller. All listeners passive — we never preventDefault.
    let lastTouch: Vec2 | null = null;
    listen(root, 'touchstart', ((e: TouchEvent) => {
      const t = e.touches[0];
      if (t) lastTouch = [t.clientX, t.clientY];
    }) as EventListener);
    listen(root, 'touchmove', ((e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || !lastTouch) return;
      const pos = normalizePosition(t.clientX, t.clientY, this.viewport);
      const delta: Vec2 = [t.clientX - lastTouch[0], t.clientY - lastTouch[1]];
      lastTouch = [t.clientX, t.clientY];
      const vel = this.scrollTracker.push(pos, e.timeStamp);
      this.onEvent?.(makeEvent('touch', e.timeStamp, pos, delta, vel));
    }) as EventListener);
    const endTouch = (): void => {
      lastTouch = null;
    };
    listen(root, 'touchend', endTouch as EventListener);
    listen(root, 'touchcancel', endTouch as EventListener);

    listen(root, 'keydown', (e: KeyboardEvent) => {
      this.onEvent?.(
        makeEvent('keyboard', e.timeStamp, [0, 0], [0, 0], [0, 0], mods(e)),
      );
    });

    const onOrientation = (e: DeviceOrientationEvent) => {
      const gamma = (e.gamma ?? 0) / 90; // -1..1 left/right tilt
      const beta = ((e.beta ?? 0) - 45) / 90; // centered around typical holding angle
      this.onEvent?.(
        makeEvent('deviceorientation', e.timeStamp, [clamp01((gamma + 1) / 2), clamp01((beta + 1) / 2)], [0, 0], [0, 0]),
      );
    };
    // iOS 13+ requires an explicit permission grant from a user gesture;
    // without requestPermission the event simply never fires, so gate the
    // listener attach behind it.
    const orientationCtor = (
      window as unknown as {
        DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
      }
    ).DeviceOrientationEvent;
    if (orientationCtor && typeof orientationCtor.requestPermission === 'function') {
      let requested = false;
      const askPermission = (): void => {
        if (requested) return;
        requested = true;
        orientationCtor
          .requestPermission!()
          .then((state) => {
            if (state === 'granted') {
              window.addEventListener('deviceorientation', onOrientation, { passive: true });
              this.cleanups.push(() => window.removeEventListener('deviceorientation', onOrientation));
            }
          })
          .catch(() => undefined); // denied/unavailable: orientation stays off
      };
      const onceOpts = { once: true, passive: true } as const;
      root.addEventListener('pointerdown', askPermission, onceOpts);
      root.addEventListener('touchstart', askPermission, onceOpts);
      this.cleanups.push(() => {
        root.removeEventListener('pointerdown', askPermission);
        root.removeEventListener('touchstart', askPermission);
      });
    } else {
      window.addEventListener('deviceorientation', onOrientation, { passive: true });
      this.cleanups.push(() => window.removeEventListener('deviceorientation', onOrientation));
    }
  }

  detach(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.trackers.clear();
    this.scrollTracker.reset();
    this.root = undefined;
  }
}
