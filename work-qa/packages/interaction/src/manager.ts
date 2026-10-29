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

import type { GestureType, InteractionBinding } from '@lumen/contracts';
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
    this.scroller = new LumenVirtualScroller({ ...opts.scroller, reducedMotion: this.reducedMotion });
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
      drivers[b.targetTrackId] = runtime.update(dt, this.reducedMotion);
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
