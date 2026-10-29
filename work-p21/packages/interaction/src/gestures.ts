/**
 * @lumen/interaction — gesture recognizers.
 *
 * Pure state machines fed by `PointerSample`s (normalized pointer/touch input
 * with lifecycle phase — see normalize.ts). No DOM access; fully unit-testable.
 *
 * Recognizers are composable and conflict-resolved by priority:
 * pinch > pan > swipe > double-tap > tap > long-press. When a higher-priority
 * recognizer claims a pointer sequence, lower-priority pending recognizers are
 * cancelled.
 */

import type { GestureType, Vec2 } from '@lumen/contracts';
import type { PointerSample } from './normalize.js';

/** Lifecycle state of an emitted gesture. */
export type GestureState = 'start' | 'update' | 'end' | 'cancel';

export interface GestureEvent {
  type: GestureType;
  state: GestureState;
  /** Centroid position, viewport-normalized. */
  position: Vec2;
  /** Delta since last update, viewport-normalized. */
  delta: Vec2;
  /** Velocity estimate, viewport units / second. */
  velocity: Vec2;
  /** Cumulative pinch scale (1 = no change); pinch only. */
  scale?: number;
  /** Cumulative rotation in radians; pinch only. */
  rotation?: number;
  /** Direction for swipe: dominant axis sign. */
  direction?: Vec2;
}

export interface GestureThresholds {
  /** Max press duration (ms) to count as a tap. */
  tapMaxDuration: number;
  /** Max movement (viewport units) before a tap becomes a pan. */
  tapMaxDistance: number;
  /** Max gap (ms) between taps of a double-tap. */
  doubleTapInterval: number;
  /** Min distance (viewport units) before a pan is recognized. */
  panMinDistance: number;
  /** Min speed (viewport units/s) at pointer-up to count as swipe. */
  swipeMinVelocity: number;
  /** Press hold time (ms) for long-press. */
  longPressDuration: number;
  /** Min scale change before pinch is recognized. */
  pinchMinScaleDelta: number;
}

export const DEFAULT_THRESHOLDS: GestureThresholds = {
  tapMaxDuration: 250,
  tapMaxDistance: 0.02,
  doubleTapInterval: 300,
  panMinDistance: 0.015,
  swipeMinVelocity: 0.8,
  longPressDuration: 500,
  pinchMinScaleDelta: 0.05,
};

type TrackedPointer = {
  id: number;
  startPos: Vec2;
  lastPos: Vec2;
  startTime: number;
  lastTime: number;
  lastVelocity: Vec2;
  moved: number; // accumulated travel distance
  active: boolean;
};

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const centroid = (ps: TrackedPointer[]): Vec2 => {
  let x = 0;
  let y = 0;
  for (const p of ps) {
    x += p.lastPos[0];
    y += p.lastPos[1];
  }
  return [x / ps.length, y / ps.length];
};

/**
 * Composite gesture recognizer. Feed pointer samples in, receive gesture events
 * via `onGesture`. Deterministic for synthetic event streams.
 */
export class GestureRecognizer {
  onGesture: ((e: GestureEvent) => void) | undefined;

  private readonly t: GestureThresholds;
  private pointers = new Map<number, TrackedPointer>();

  // pending tap/long-press state (single pointer)
  private pendingPress: { id: number; pos: Vec2; time: number } | undefined;
  private lastTap: { pos: Vec2; time: number } | undefined;
  private longPressTimer: ReturnType<typeof setTimeout> | undefined;
  private longPressFired = false;

  // active pan/pinch state
  private panActive = false;
  private pinchActive = false;
  private pinchStartDist = 0;
  private pinchStartAngle = 0;
  private lastCentroid: Vec2 | undefined;

  constructor(thresholds: Partial<GestureThresholds> = {}) {
    this.t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /** Feed one pointer sample. */
  feed(sample: PointerSample): void {
    switch (sample.phase) {
      case 'start':
        this.onDown(sample);
        break;
      case 'move':
        this.onMove(sample);
        break;
      case 'end':
        this.onUp(sample, false);
        break;
      case 'cancel':
        this.onUp(sample, true);
        break;
    }
  }

  /** Cancel all in-progress recognition (e.g. on detach). */
  reset(): void {
    this.pointers.clear();
    this.pendingPress = undefined;
    this.clearLongPress();
    this.panActive = false;
    this.pinchActive = false;
    this.lastCentroid = undefined;
    this.longPressFired = false;
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== undefined) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = undefined;
    }
  }

  private activePointers(): TrackedPointer[] {
    return [...this.pointers.values()].filter((p) => p.active);
  }

  private emit(e: GestureEvent): void {
    this.onGesture?.(e);
  }

  private onDown(s: PointerSample): void {
    const p: TrackedPointer = {
      id: s.pointerId,
      startPos: [s.position[0], s.position[1]],
      lastPos: [s.position[0], s.position[1]],
      startTime: s.timestamp,
      lastTime: s.timestamp,
      lastVelocity: [0, 0],
      moved: 0,
      active: true,
    };
    this.pointers.set(s.pointerId, p);

    if (this.pointers.size === 2) {
      // Second finger: cancel tap/long-press candidates; pinch may begin.
      this.cancelPendingPress();
      const [a, b] = this.activePointers();
      this.pinchStartDist = Math.max(dist(a.lastPos, b.lastPos), 1e-6);
      this.pinchStartAngle = Math.atan2(b.lastPos[1] - a.lastPos[1], b.lastPos[0] - a.lastPos[0]);
      this.lastCentroid = centroid(this.activePointers());
    } else if (this.pointers.size === 1) {
      this.pendingPress = { id: s.pointerId, pos: [s.position[0], s.position[1]], time: s.timestamp };
      this.longPressFired = false;
      this.clearLongPress();
      this.longPressTimer = setTimeout(() => {
        const pp = this.pendingPress;
        if (pp && !this.panActive && !this.pinchActive && pp.id === s.pointerId) {
          this.longPressFired = true;
          this.pendingPress = undefined;
          this.emit({
            type: 'longpress',
            state: 'start',
            position: [pp.pos[0], pp.pos[1]],
            delta: [0, 0],
            velocity: [0, 0],
          });
        }
      }, this.t.longPressDuration);
    }
  }

  private cancelPendingPress(): void {
    this.pendingPress = undefined;
    this.clearLongPress();
  }

  private onMove(s: PointerSample): void {
    const p = this.pointers.get(s.pointerId);
    if (!p || !p.active) return;
    const step = dist(p.lastPos, s.position);
    p.moved += step;
    p.lastPos = [s.position[0], s.position[1]];
    p.lastTime = s.timestamp;
    p.lastVelocity = [s.velocity[0], s.velocity[1]];

    if (this.pendingPress && p.moved > this.t.tapMaxDistance) {
      this.cancelPendingPress();
    }

    const active = this.activePointers();

    if (active.length >= 2) {
      // Pinch recognizer (highest priority).
      const [a, b] = active;
      const d = Math.max(dist(a.lastPos, b.lastPos), 1e-6);
      const scale = d / this.pinchStartDist;
      const angle = Math.atan2(b.lastPos[1] - a.lastPos[1], b.lastPos[0] - a.lastPos[0]);
      const rotation = angle - this.pinchStartAngle;
      const c = centroid(active);
      const delta: Vec2 = this.lastCentroid ? sub(c, this.lastCentroid) : [0, 0];
      this.lastCentroid = c;
      if (!this.pinchActive) {
        if (Math.abs(scale - 1) >= this.t.pinchMinScaleDelta) {
          this.pinchActive = true;
          this.cancelPendingPress();
          if (this.panActive) {
            this.panActive = false;
            this.emit({ type: 'pan', state: 'cancel', position: c, delta: [0, 0], velocity: [0, 0] });
          }
          this.emit({ type: 'pinch', state: 'start', position: c, delta, velocity: s.velocity, scale, rotation });
        }
      } else {
        this.emit({ type: 'pinch', state: 'update', position: c, delta, velocity: s.velocity, scale, rotation });
      }
      return;
    }

    // Single pointer: pan recognizer.
    if (!this.pinchActive && !this.longPressFired && !this.panActive && p.moved > this.t.panMinDistance) {
      this.panActive = true;
      this.cancelPendingPress();
      this.emit({
        type: 'pan',
        state: 'start',
        position: [p.lastPos[0], p.lastPos[1]],
        delta: sub(p.lastPos, p.startPos),
        velocity: p.lastVelocity,
      });
    } else if (this.panActive) {
      this.emit({
        type: 'pan',
        state: 'update',
        position: [p.lastPos[0], p.lastPos[1]],
        delta: [s.velocity[0] * 0.016, s.velocity[1] * 0.016],
        velocity: p.lastVelocity,
      });
    }
  }

  private onUp(s: PointerSample, cancelled: boolean): void {
    const p = this.pointers.get(s.pointerId);
    this.pointers.delete(s.pointerId);
    if (!p) return;

    if (this.pinchActive) {
      if (this.activePointers().length < 2) {
        this.pinchActive = false;
        this.lastCentroid = undefined;
        this.emit({
          type: 'pinch',
          state: cancelled ? 'cancel' : 'end',
          position: [p.lastPos[0], p.lastPos[1]],
          delta: [0, 0],
          velocity: [0, 0],
        });
      }
      return;
    }

    if (this.panActive && this.activePointers().length === 0) {
      this.panActive = false;
      // Swipe: pan ended with high velocity.
      const speed = Math.hypot(p.lastVelocity[0], p.lastVelocity[1]);
      if (!cancelled && speed >= this.t.swipeMinVelocity) {
        const dir: Vec2 =
          Math.abs(p.lastVelocity[0]) >= Math.abs(p.lastVelocity[1])
            ? [Math.sign(p.lastVelocity[0]), 0]
            : [0, Math.sign(p.lastVelocity[1])];
        this.emit({
          type: 'swipe',
          state: 'end',
          position: [p.lastPos[0], p.lastPos[1]],
          delta: [0, 0],
          velocity: p.lastVelocity,
          direction: dir,
        });
      }
      this.emit({
        type: 'pan',
        state: cancelled ? 'cancel' : 'end',
        position: [p.lastPos[0], p.lastPos[1]],
        delta: [0, 0],
        velocity: p.lastVelocity,
      });
      return;
    }

    const pp = this.pendingPress;
    if (pp && pp.id === s.pointerId) {
      this.pendingPress = undefined;
      this.clearLongPress();
      const duration = s.timestamp - pp.time;
      if (!cancelled && !this.longPressFired && duration <= this.t.tapMaxDuration && p.moved <= this.t.tapMaxDistance) {
        const now = s.timestamp;
        const lt = this.lastTap;
        if (lt && now - lt.time <= this.t.doubleTapInterval && dist(lt.pos, pp.pos) <= this.t.tapMaxDistance * 2) {
          this.lastTap = undefined;
          this.emit({
            type: 'tap',
            state: 'end',
            position: [pp.pos[0], pp.pos[1]],
            delta: [0, 0],
            velocity: [0, 0],
          });
          // Double-tap: emitted as a second tap immediately after; consumers
          // distinguish by checking `isDoubleTap()`.
          this.emit({
            type: 'tap',
            state: 'end',
            position: [pp.pos[0], pp.pos[1]],
            delta: [0, 0],
            velocity: [0, 0],
          });
        } else {
          this.lastTap = { pos: [pp.pos[0], pp.pos[1]], time: now };
          this.emit({
            type: 'tap',
            state: 'end',
            position: [pp.pos[0], pp.pos[1]],
            delta: [0, 0],
            velocity: [0, 0],
          });
        }
      }
    }

    if (this.longPressFired && this.activePointers().length === 0) {
      this.longPressFired = false;
      this.emit({
        type: 'longpress',
        state: cancelled ? 'cancel' : 'end',
        position: [p.lastPos[0], p.lastPos[1]],
        delta: [0, 0],
        velocity: [0, 0],
      });
    }
  }
}

/**
 * Helper to detect double-tap from a tap event stream: returns true when the
 * given tap index follows another tap within the interval at a nearby position.
 * (The recognizer emits double-taps as two consecutive tap events; stateless
 * consumers can use this accumulator instead.)
 */
export function createDoubleTapDetector(intervalMs: number, maxDistance: number) {
  let last: { pos: Vec2; time: number } | undefined;
  return {
    /** Returns true if this tap completes a double-tap. */
    isDoubleTap(pos: Vec2, time: number): boolean {
      const dbl = !!last && time - last.time <= intervalMs && dist(last.pos, pos) <= maxDistance;
      last = dbl ? undefined : { pos: [pos[0], pos[1]], time };
      return dbl;
    },
    reset(): void {
      last = undefined;
    },
  };
}
