/**
 * @lumen/interaction — InteractionManager.
 *
 * Top-level facade composing normalization, gestures, virtual scrolling and
 * binding runtimes.
 *
 * Lifecycle (owned by the Kernel):
 *   const manager = new InteractionManager({ bindings });
 *   manager.attach(rootEl);
 *   // each frame, from the Kernel scheduler:
 *   const drivers = manager.update(dt); // { [trackId]: scalarSeconds }
 *   scene.evaluate(time, { drivers });
 *   // on teardown:
 *   manager.detach();
 *
 * The returned driver map is the handshake with @lumen/scene: keys are
 * TimelineTrack.id values; values are timeline scalars in seconds. Scene's
 * evaluate() merges them via its `drivers` param.
 */

import type { GestureType, InteractionBinding, MotionPolicy, TrackSmoothing } from '@lumen/contracts';
import { GestureRecognizer, type GestureEvent, type GestureThresholds } from './gestures.js';
import { BindingRuntime, isStaticFallback } from './bindings.js';
import { InputNormalizer } from './normalize.js';
import { LumenVirtualScroller, type VirtualScrollerOptions } from './scroll.js';

export interface InteractionManagerOptions {
  /** Initial bindings. */
  bindings?: InteractionBinding[];
  /** Gesture threshold overrides. */
  gestureThresholds?: Partial<GestureThresholds>;
  /** Virtual scroller options. */
  scroller?: VirtualScrollerOptions;
  /** Honor prefers-reduced-motion (auto-detected in browser; pass explicitly in tests/SSR). */
  reducedMotion?: boolean;
  /**
   * P1: engine-owned motion policy. When present, `policy.mode !== 'continuous'`
   * supersedes the raw reducedMotion boolean for binding updates and the
   * scroller's interpolation policy.
   */
  motion?: MotionPolicy;
  /**
   * P15: per-track driver smoothing descriptors (keyed by track id).
   * 'lerp'/'spring' smooth the driver value with frame-rate compensation;
   * 'none' passes the raw value through (snap). A motion policy whose mode
   * is not 'continuous' forces 'none'. Absent ⇒ single global scroller
   * smoothing, unchanged.
   */
  trackSmoothing?: Readonly<Record<string, TrackSmoothing>>;
  /**
   * Optional step-navigation *intent* hook — emits raw 'next' / 'prev' steps
   * for keyboard navigation. Interaction deliberately does not know navigation
   * event names; the runtime (`@lumen/runtime` engine.ts) is the sole place
   * mapping this intent to 'scene:next' / 'scene:prev' bus events.
   */
  onNavigate?: (direction: 'next' | 'prev') => void;
}

/** Driver map handed to scene.evaluate(): TimelineTrack.id → scalar seconds. */
export type DriverMap = Record<string, number>;

export class InteractionManager {
  readonly scroller: LumenVirtualScroller;
  readonly gestures: GestureRecognizer;
  readonly normalizer: InputNormalizer;

  private bindings = new Map<string, BindingRuntime>();
  private reducedMotion: boolean;
  private readonly motionPolicy?: MotionPolicy;
  private readonly trackSmoothing?: Readonly<Record<string, TrackSmoothing>>;
  private readonly smoothState = new Map<string, { pos: number; vel: number }>();
  private onNavigate?: (d: 'next' | 'prev') => void;
  private attachedRoot: HTMLElement | undefined;
  private keyboardCleanup: Array<() => void> = [];
  private motionQueryCleanup: (() => void) | undefined;
  private gestureAccum = new Map<string, number>(); // bindingId → accumulated gesture input
  private lastDrivers: DriverMap = {};

  constructor(opts: InteractionManagerOptions = {}) {
    this.reducedMotion =
      opts.reducedMotion ??
      (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false);
    this.onNavigate = opts.onNavigate;
    this.motionPolicy = opts.motion;
    this.trackSmoothing = opts.trackSmoothing;
    this.scroller = new LumenVirtualScroller({
      ...opts.scroller,
      reducedMotion: this.reducedMotion,
      ...(opts.motion ? { motion: opts.motion } : {}),
    });
    this.gestures = new GestureRecognizer(opts.gestureThresholds);
    this.normalizer = new InputNormalizer({ wheelMultiplier: opts.scroller?.wheelMultiplier });
    // Wire the DOM-free pipeline in the constructor so the manager is fully
    // functional headless (tests, SSR); attach() only adds DOM listeners.
    this.normalizer.onEvent = (e) => {
      if (e.source === 'scroll') {
        this.scroller.feedDelta(e.delta[1]);
      } else if (e.source === 'touch') {
        // Touch deltas are raw finger movement: finger up (negative dy)
        // scrolls content down (positive scroller delta).
        this.scroller.feedDelta(-e.delta[1]);
      }
    };
    this.normalizer.onPointer = (sample) => this.gestures.feed(sample);
    this.gestures.onGesture = (g) => this.dispatchGesture(g);
    for (const b of opts.bindings ?? []) this.registerBinding(b);
  }

  get isReducedMotion(): boolean {
    return this.reducedMotion;
  }

  registerBinding(binding: InteractionBinding): void {
    this.bindings.set(binding.id, new BindingRuntime(binding));
  }

  registerBindings(bindings: InteractionBinding[]): void {
    for (const b of bindings) this.registerBinding(b);
  }

  unregisterBinding(id: string): void {
    this.bindings.delete(id);
    this.gestureAccum.delete(id);
  }

  /** Wire DOM listeners. Browser-only; safe no-op in Node. */
  attach(rootEl: HTMLElement): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (this.attachedRoot) this.detach();
    this.attachedRoot = rootEl;

    this.normalizer.attach(rootEl);

    // Keyboard / ARIA support for 'steps' fallback bindings.
    const onKey = (ev: KeyboardEvent) => {
      const stepBindings = [...this.bindings.values()].filter(
        (r) => r.binding.a11yFallback === 'steps' && !isStaticFallback(r.binding.a11yFallback),
      );
      if (stepBindings.length === 0) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight' || ev.key === 'PageDown') {
        for (const r of stepBindings) r.stepNext();
        this.onNavigate?.('next');
        ev.preventDefault();
      } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft' || ev.key === 'PageUp') {
        for (const r of stepBindings) r.stepPrev();
        this.onNavigate?.('prev');
        ev.preventDefault();
      } else if (ev.key === 'Home') {
        for (const r of stepBindings) {
          r.feedInput(r.binding.mapping.inputRange[0]);
        }
        ev.preventDefault();
      } else if (ev.key === 'End') {
        for (const r of stepBindings) {
          r.feedInput(r.binding.mapping.inputRange[1]);
        }
        ev.preventDefault();
      }
    };
    rootEl.addEventListener('keydown', onKey);
    this.keyboardCleanup.push(() => rootEl.removeEventListener('keydown', onKey));

    // Track prefers-reduced-motion changes live.
    if (typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const onChange = () => {
        this.reducedMotion = mq.matches;
        this.scroller.setReducedMotion(mq.matches);
      };
      mq.addEventListener('change', onChange);
      this.motionQueryCleanup = () => mq.removeEventListener('change', onChange);
    }
  }

  private dispatchGesture(g: GestureEvent): void {
    for (const runtime of this.bindings.values()) {
      const b = runtime.binding;
      if (!b.gesture || b.gesture !== (g.type as GestureType)) continue;
      if (isStaticFallback(b.a11yFallback)) continue;
      const span = b.mapping.inputRange[1] - b.mapping.inputRange[0];
      let acc = this.gestureAccum.get(b.id) ?? b.mapping.inputRange[0];
      if (g.state === 'start') {
        acc = b.mapping.inputRange[0];
      } else if (g.state === 'update' || g.state === 'end') {
        if (g.type === 'pinch' && g.scale !== undefined) {
          acc = b.mapping.inputRange[0] + (g.scale - 1) * span;
        } else if (g.type === 'pan' || g.type === 'swipe') {
          acc += g.delta[1] !== 0 ? g.delta[1] * span : g.delta[0] * span;
        } else {
          acc = b.mapping.inputRange[1]; // tap/longpress: jump to end
        }
      }
      this.gestureAccum.set(b.id, acc);
      runtime.feedInput(acc);
    }
  }

  /**
   * Advance all interaction state by one frame. Called by the Kernel scheduler
   * exactly once per frame. Returns the driver map for scene.evaluate().
   */
  update(dt: number): DriverMap {
    const scrollProgress = this.scroller.update(dt);
    const drivers: DriverMap = {};
    for (const runtime of this.bindings.values()) {
      const b = runtime.binding;
      if (b.source === 'scroll' && !b.gesture) {
        runtime.feedInput(scrollProgress);
      }
      drivers[b.targetTrackId] = runtime.update(
        dt,
        this.motionPolicy ? this.motionPolicy.mode !== 'continuous' : this.reducedMotion,
      );
    }
    // P15: per-track driver smoothing (overrides the global scroller lerp
    // for tracks that declare it). The motion policy forces 'none' under
    // reveal/static so reduced motion always snaps.
    if (this.trackSmoothing) {
      const frames = Math.max(dt, 0) * 60;
      const forceNone = this.motionPolicy !== undefined && this.motionPolicy.mode !== 'continuous';
      for (const [trackId, cfg] of Object.entries(this.trackSmoothing)) {
        const target = drivers[trackId];
        if (target === undefined) continue;
        const mode = forceNone ? 'none' : cfg.mode;
        if (mode === 'none') {
          this.smoothState.delete(trackId); // snap: raw value passes through
          continue;
        }
        let st = this.smoothState.get(trackId);
        if (!st) {
          st = { pos: target, vel: 0 };
          this.smoothState.set(trackId, st);
        }
        if (mode === 'lerp') {
          const s = cfg.stiffness ?? 0.12;
          const alpha = 1 - Math.pow(1 - s, frames);
          st.pos += (target - st.pos) * alpha;
        } else {
          // Spring: semi-implicit Euler, frame-rate compensated vs 60fps.
          const k = cfg.stiffness ?? 0.1;
          const d = cfg.damping ?? 0.85;
          st.vel = (st.vel + (target - st.pos) * k * frames) * Math.pow(d, frames);
          st.pos += st.vel * frames;
          if (Math.abs(target - st.pos) < 1e-6 && Math.abs(st.vel) < 1e-6) {
            st.pos = target;
            st.vel = 0;
          }
        }
        drivers[trackId] = st.pos;
      }
    }
    this.lastDrivers = drivers;
    return drivers;
  }

  /** Last computed driver map (no state advance). */
  get drivers(): DriverMap {
    return { ...this.lastDrivers };
  }

  detach(): void {
    this.normalizer.detach();
    this.scroller.detach();
    this.gestures.reset();
    for (const f of this.keyboardCleanup) f();
    this.keyboardCleanup = [];
    this.motionQueryCleanup?.();
    this.motionQueryCleanup = undefined;
    this.attachedRoot = undefined;
  }
}
