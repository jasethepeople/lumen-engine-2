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
import { GestureRecognizer } from './gestures.js';
import { BindingRuntime, isStaticFallback } from './bindings.js';
import { InputNormalizer } from './normalize.js';
import { LumenVirtualScroller } from './scroll.js';
export class InteractionManager {
    scroller;
    gestures;
    normalizer;
    bindings = new Map();
    reducedMotion;
    motionPolicy;
    trackSmoothing;
    smoothState = new Map();
    onNavigate;
    attachedRoot;
    keyboardCleanup = [];
    motionQueryCleanup;
    gestureAccum = new Map(); // bindingId → accumulated gesture input
    lastDrivers = {};
    constructor(opts = {}) {
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
            }
            else if (e.source === 'touch') {
                // Touch deltas are raw finger movement: finger up (negative dy)
                // scrolls content down (positive scroller delta).
                this.scroller.feedDelta(-e.delta[1]);
            }
        };
        this.normalizer.onPointer = (sample) => this.gestures.feed(sample);
        this.gestures.onGesture = (g) => this.dispatchGesture(g);
        for (const b of opts.bindings ?? [])
            this.registerBinding(b);
    }
    get isReducedMotion() {
        return this.reducedMotion;
    }
    registerBinding(binding) {
        this.bindings.set(binding.id, new BindingRuntime(binding));
    }
    registerBindings(bindings) {
        for (const b of bindings)
            this.registerBinding(b);
    }
    unregisterBinding(id) {
        this.bindings.delete(id);
        this.gestureAccum.delete(id);
    }
    /** Wire DOM listeners. Browser-only; safe no-op in Node. */
    attach(rootEl) {
        if (typeof window === 'undefined' || typeof document === 'undefined')
            return;
        if (this.attachedRoot)
            this.detach();
        this.attachedRoot = rootEl;
        this.normalizer.attach(rootEl);
        // Keyboard / ARIA support for 'steps' fallback bindings.
        const onKey = (ev) => {
            const stepBindings = [...this.bindings.values()].filter((r) => r.binding.a11yFallback === 'steps' && !isStaticFallback(r.binding.a11yFallback));
            if (stepBindings.length === 0)
                return;
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight' || ev.key === 'PageDown') {
                for (const r of stepBindings)
                    r.stepNext();
                this.onNavigate?.('next');
                ev.preventDefault();
            }
            else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft' || ev.key === 'PageUp') {
                for (const r of stepBindings)
                    r.stepPrev();
                this.onNavigate?.('prev');
                ev.preventDefault();
            }
            else if (ev.key === 'Home') {
                for (const r of stepBindings) {
                    r.feedInput(r.binding.mapping.inputRange[0]);
                }
                ev.preventDefault();
            }
            else if (ev.key === 'End') {
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
    dispatchGesture(g) {
        for (const runtime of this.bindings.values()) {
            const b = runtime.binding;
            if (!b.gesture || b.gesture !== g.type)
                continue;
            if (isStaticFallback(b.a11yFallback))
                continue;
            const span = b.mapping.inputRange[1] - b.mapping.inputRange[0];
            let acc = this.gestureAccum.get(b.id) ?? b.mapping.inputRange[0];
            if (g.state === 'start') {
                acc = b.mapping.inputRange[0];
            }
            else if (g.state === 'update' || g.state === 'end') {
                if (g.type === 'pinch' && g.scale !== undefined) {
                    acc = b.mapping.inputRange[0] + (g.scale - 1) * span;
                }
                else if (g.type === 'pan' || g.type === 'swipe') {
                    acc += g.delta[1] !== 0 ? g.delta[1] * span : g.delta[0] * span;
                }
                else {
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
    update(dt) {
        const scrollProgress = this.scroller.update(dt);
        const drivers = {};
        for (const runtime of this.bindings.values()) {
            const b = runtime.binding;
            if (b.source === 'scroll' && !b.gesture) {
                runtime.feedInput(scrollProgress);
            }
            drivers[b.targetTrackId] = runtime.update(dt, this.motionPolicy ? this.motionPolicy.mode !== 'continuous' : this.reducedMotion);
        }
        // P15: per-track driver smoothing (overrides the global scroller lerp
        // for tracks that declare it). The motion policy forces 'none' under
        // reveal/static so reduced motion always snaps.
        if (this.trackSmoothing) {
            const frames = Math.max(dt, 0) * 60;
            const forceNone = this.motionPolicy !== undefined && this.motionPolicy.mode !== 'continuous';
            for (const [trackId, cfg] of Object.entries(this.trackSmoothing)) {
                const target = drivers[trackId];
                if (target === undefined)
                    continue;
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
                }
                else {
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
    get drivers() {
        return { ...this.lastDrivers };
    }
    detach() {
        this.normalizer.detach();
        this.scroller.detach();
        this.gestures.reset();
        for (const f of this.keyboardCleanup)
            f();
        this.keyboardCleanup = [];
        this.motionQueryCleanup?.();
        this.motionQueryCleanup = undefined;
        this.attachedRoot = undefined;
    }
}
