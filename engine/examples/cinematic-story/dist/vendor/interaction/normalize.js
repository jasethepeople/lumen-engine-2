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
/** Zero vector constant (do not mutate). */
const ZERO = [0, 0];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Normalize a pixel coordinate to viewport units (0–1), clamped. */
export function normalizePosition(clientX, clientY, viewport) {
    const [w, h] = viewport;
    return [clamp01(w > 0 ? clientX / w : 0), clamp01(h > 0 ? clientY / h : 0)];
}
/** Normalize a pixel delta to viewport units. */
export function normalizeDelta(dx, dy, viewport) {
    const [w, h] = viewport;
    return [w > 0 ? dx / w : 0, h > 0 ? dy / h : 0];
}
/**
 * Estimate velocity (viewport units / second) from a delta and elapsed ms.
 * Returns ZERO when dt is non-positive.
 */
export function estimateVelocity(delta, dtMs) {
    if (dtMs <= 0)
        return [ZERO[0], ZERO[1]];
    const s = 1000 / dtMs;
    return [delta[0] * s, delta[1] * s];
}
/** Smooth velocity tracker with exponential decay (per input source/pointer). */
export function createVelocityTracker() {
    let state;
    return {
        push(position, timestamp) {
            if (!state) {
                state = { lastPosition: position, lastTimestamp: timestamp, velocity: [0, 0] };
                return [0, 0];
            }
            const dt = timestamp - state.lastTimestamp;
            const raw = estimateVelocity([position[0] - state.lastPosition[0], position[1] - state.lastPosition[1]], dt);
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
export function makeEvent(source, timestamp, position, delta, velocity, modifiers = { shift: false, ctrl: false, alt: false }) {
    return {
        source,
        timestamp,
        position: [position[0], position[1]],
        delta: [delta[0], delta[1]],
        velocity: [velocity[0], velocity[1]],
        modifiers: { ...modifiers },
    };
}
const mods = (e) => ({
    shift: e.shiftKey,
    ctrl: e.ctrlKey,
    alt: e.altKey,
});
/**
 * Wires DOM listeners and emits normalized events. Browser-only: `attach()` is
 * a no-op outside a DOM environment. All continuous listeners are passive.
 */
export class InputNormalizer {
    root;
    viewport = [1, 1];
    wheelMultiplier;
    cleanups = [];
    trackers = new Map();
    scrollTracker = createVelocityTracker();
    onEvent;
    onPointer;
    constructor(opts = {}) {
        this.wheelMultiplier = opts.wheelMultiplier ?? 1;
    }
    /** Current viewport in px (updated on attach/resize). */
    get viewportSize() {
        return [this.viewport[0], this.viewport[1]];
    }
    attach(root) {
        if (typeof window === 'undefined' || typeof document === 'undefined')
            return;
        if (this.root)
            this.detach();
        this.root = root;
        this.viewport = [window.innerWidth || 1, window.innerHeight || 1];
        const listen = (target, type, handler, passive = true) => {
            target.addEventListener(type, handler, { passive });
            this.cleanups.push(() => target.removeEventListener(type, handler));
        };
        listen(window, 'resize', () => {
            this.viewport = [window.innerWidth || 1, window.innerHeight || 1];
        });
        // Wheel: deltaMode 1 = lines (≈16px), 2 = pages (≈viewport height).
        listen(root, 'wheel', (e) => {
            const modeScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.viewport[1] : 1;
            const delta = normalizeDelta(e.deltaX * modeScale * this.wheelMultiplier, e.deltaY * modeScale * this.wheelMultiplier, this.viewport);
            const pos = normalizePosition(e.clientX, e.clientY, this.viewport);
            const vel = this.scrollTracker.push(pos, e.timeStamp);
            this.onEvent?.(makeEvent('scroll', e.timeStamp, pos, delta, vel, mods(e)));
        });
        const pointer = (phase) => (e) => {
            const pos = normalizePosition(e.clientX, e.clientY, this.viewport);
            let tracker = this.trackers.get(e.pointerId);
            if (!tracker || phase === 'start') {
                tracker = createVelocityTracker();
                this.trackers.set(e.pointerId, tracker);
            }
            const velocity = tracker.push(pos, e.timeStamp);
            const delta = phase === 'move' ? [velocity[0] * 0.016, velocity[1] * 0.016] : [0, 0];
            const base = makeEvent(e.pointerType === 'touch' ? 'touch' : 'pointer', e.timeStamp, pos, delta, velocity, mods(e));
            const sample = { ...base, phase, pointerId: e.pointerId };
            this.onPointer?.(sample);
            if (phase === 'end' || phase === 'cancel')
                this.trackers.delete(e.pointerId);
        };
        listen(root, 'pointerdown', pointer('start'));
        listen(root, 'pointermove', pointer('move'));
        listen(root, 'pointerup', pointer('end'));
        listen(root, 'pointercancel', pointer('cancel'));
        // Touch: pointer events do not feed the virtual scroller, so map vertical
        // drags onto scroll deltas here. delta is raw finger movement (positive =
        // finger moved down = scroll up); the manager negates it when feeding the
        // scroller. All listeners passive — we never preventDefault.
        let lastTouch = null;
        listen(root, 'touchstart', ((e) => {
            const t = e.touches[0];
            if (t)
                lastTouch = [t.clientX, t.clientY];
        }));
        listen(root, 'touchmove', ((e) => {
            const t = e.touches[0];
            if (!t || !lastTouch)
                return;
            const pos = normalizePosition(t.clientX, t.clientY, this.viewport);
            const delta = [t.clientX - lastTouch[0], t.clientY - lastTouch[1]];
            lastTouch = [t.clientX, t.clientY];
            const vel = this.scrollTracker.push(pos, e.timeStamp);
            this.onEvent?.(makeEvent('touch', e.timeStamp, pos, delta, vel));
        }));
        const endTouch = () => {
            lastTouch = null;
        };
        listen(root, 'touchend', endTouch);
        listen(root, 'touchcancel', endTouch);
        listen(root, 'keydown', (e) => {
            this.onEvent?.(makeEvent('keyboard', e.timeStamp, [0, 0], [0, 0], [0, 0], mods(e)));
        });
        const onOrientation = (e) => {
            const gamma = (e.gamma ?? 0) / 90; // -1..1 left/right tilt
            const beta = ((e.beta ?? 0) - 45) / 90; // centered around typical holding angle
            this.onEvent?.(makeEvent('deviceorientation', e.timeStamp, [clamp01((gamma + 1) / 2), clamp01((beta + 1) / 2)], [0, 0], [0, 0]));
        };
        // iOS 13+ requires an explicit permission grant from a user gesture;
        // without requestPermission the event simply never fires, so gate the
        // listener attach behind it.
        const orientationCtor = window.DeviceOrientationEvent;
        if (orientationCtor && typeof orientationCtor.requestPermission === 'function') {
            let requested = false;
            const askPermission = () => {
                if (requested)
                    return;
                requested = true;
                orientationCtor
                    .requestPermission()
                    .then((state) => {
                    if (state === 'granted') {
                        window.addEventListener('deviceorientation', onOrientation, { passive: true });
                        this.cleanups.push(() => window.removeEventListener('deviceorientation', onOrientation));
                    }
                })
                    .catch(() => undefined); // denied/unavailable: orientation stays off
            };
            const onceOpts = { once: true, passive: true };
            root.addEventListener('pointerdown', askPermission, onceOpts);
            root.addEventListener('touchstart', askPermission, onceOpts);
            this.cleanups.push(() => {
                root.removeEventListener('pointerdown', askPermission);
                root.removeEventListener('touchstart', askPermission);
            });
        }
        else {
            window.addEventListener('deviceorientation', onOrientation, { passive: true });
            this.cleanups.push(() => window.removeEventListener('deviceorientation', onOrientation));
        }
    }
    detach() {
        for (const c of this.cleanups)
            c();
        this.cleanups = [];
        this.trackers.clear();
        this.scrollTracker.reset();
        this.root = undefined;
    }
}
