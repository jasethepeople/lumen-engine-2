/**
 * @lumen/interaction — virtual scroller.
 *
 * Implements the frozen `VirtualScroller` contract: raw wheel/touch scroll
 * deltas are consumed into a smoothed, clamped virtual playhead. The mapping is
 * frame-deterministic: `feedDelta()` accumulates raw input; `update(dt)`
 * advances the smoothed progress exactly once per frame, so timeline scrubbing
 * is consistent across browsers and input devices.
 */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export class LumenVirtualScroller {
    target = 0; // raw accumulated target progress, 0–1
    current = 0; // smoothed progress, 0–1
    enabled = true;
    smoothing;
    wheelMultiplier;
    snapPoints;
    snapThreshold;
    reducedMotion;
    policy;
    onProgress;
    restorationKey;
    lastRestorationWriteAt = -Infinity;
    detachFns = [];
    constructor(opts = {}) {
        this.smoothing = opts.smoothing ?? 0.12;
        this.wheelMultiplier = opts.wheelMultiplier ?? 1;
        this.snapPoints = opts.snap ? [...opts.snap].sort((a, b) => a - b) : [];
        this.snapThreshold = opts.snapThreshold ?? 0.02;
        this.reducedMotion = opts.reducedMotion ?? false;
        this.policy = opts.motion;
        this.onProgress = opts.onProgress;
        this.restorationKey = opts.restorationKey;
        if (this.restorationKey !== undefined && typeof window !== 'undefined' && typeof history !== 'undefined') {
            const onPopState = (ev) => {
                const saved = ev.state?.lumenScroll?.[this.restorationKey];
                if (typeof saved === 'number') {
                    // Re-feed through the single write seam; update() republishes via
                    // onProgress next frame (instantly under reduced motion).
                    this.setTargetFromNormalized(saved);
                }
            };
            window.addEventListener('popstate', onPopState);
            this.detachFns.push(() => window.removeEventListener('popstate', onPopState));
        }
    }
    /** Effective reduced-motion flag: policy mode wins when a policy is injected. */
    get reduced() {
        return this.policy ? this.policy.mode !== 'continuous' : this.reducedMotion;
    }
    get progress() {
        return this.current;
    }
    /** Raw (unsmoothed) target — useful for tests and determinism checks. */
    get targetProgress() {
        return this.target;
    }
    setReducedMotion(on) {
        this.reducedMotion = on;
        if (this.reduced)
            this.current = this.target;
    }
    setSnapPoints(points) {
        this.snapPoints = [...points].sort((a, b) => a - b);
    }
    /**
     * P9: single entry for ALL absolute progress writes (native scroll,
     * history restoration). Converges with feedDelta on identical state
     * transitions: same clamp, same reduced-motion fast path.
     */
    setTargetFromNormalized(p) {
        if (!this.enabled)
            return;
        this.target = clamp01(p);
        if (this.reduced) {
            this.current = this.target;
            this.onProgress?.(this.current);
        }
    }
    /**
     * Consume a raw scroll delta (in progress units; positive = scroll down).
     * No-op while disabled. Applied to the target; smoothing happens in update().
     */
    feedDelta(deltaProgress) {
        if (!this.enabled)
            return;
        this.target = clamp01(this.target + deltaProgress * this.wheelMultiplier);
        if (this.reduced) {
            this.current = this.target;
            this.onProgress?.(this.current);
        }
    }
    /**
     * Advance the smoothed playhead. Call exactly once per frame from the Kernel
     * scheduler. `dt` is in seconds; lerp is frame-rate compensated against a
     * 60fps baseline.
     */
    update(dt) {
        const prev = this.current;
        if (this.policy && this.policy.mode === 'reveal' && this.snapPoints.length > 0) {
            // P1: reveal steps scroll progress to snap boundaries (state changes only).
            this.target = this.policy.quantizeScrub(this.target, this.snapPoints);
        }
        if (!this.reduced) {
            const frames = Math.max(dt, 0) * 60;
            const alpha = 1 - Math.pow(1 - this.smoothing, frames);
            this.current += (this.target - this.current) * alpha;
            // Settle: snap or converge when close enough.
            if (Math.abs(this.target - this.current) < 1e-4) {
                this.current = this.target;
                const snapped = this.nearestSnap(this.target);
                if (snapped !== undefined) {
                    this.target = snapped;
                    this.current = snapped;
                }
                this.persistForRestoration();
            }
        }
        else if (this.policy) {
            // Policy-driven cut (reveal/static): identical to the legacy jump but
            // owned by the MotionPolicy so all clamp sites agree.
            this.current = this.policy.interpolate(this.current, this.target, 1);
        }
        if (this.current !== prev)
            this.onProgress?.(this.current);
        return this.current;
    }
    /**
     * P9: persist settled progress for history restoration, at most once per
     * 500 ms; a no-op without a restorationKey or history global.
     */
    persistForRestoration() {
        if (this.restorationKey === undefined)
            return;
        if (typeof window === 'undefined' || typeof history === 'undefined')
            return;
        const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (nowMs - this.lastRestorationWriteAt < 500)
            return;
        this.lastRestorationWriteAt = nowMs;
        try {
            const state = (history.state ?? {});
            const lumenScroll = { ...(state.lumenScroll ?? {}) };
            lumenScroll[this.restorationKey] = this.current;
            history.replaceState({ ...state, lumenScroll }, '');
        }
        catch {
            // History APIs can throw (opaque origins, quota); restoration is best-effort.
        }
    }
    nearestSnap(p) {
        let best;
        let bestDist = this.snapThreshold;
        for (const s of this.snapPoints) {
            const d = Math.abs(s - p);
            if (d <= bestDist) {
                best = s;
                bestDist = d;
            }
        }
        return best;
    }
    seek(p, opts) {
        const target = clamp01(p);
        this.target = target;
        if (opts?.animate === false || this.reduced) {
            this.current = target;
            this.onProgress?.(this.current);
        }
    }
    setEnabled(on) {
        this.enabled = on;
    }
    /**
     * Attach to a scroll container. Browser-only; guarded no-op without a DOM.
     * Uses native scroll position of the element (scrollTop / scrollable height)
     * as the raw input source.
     */
    attach(el) {
        if (typeof window === 'undefined')
            return;
        const onScroll = () => {
            const max = el.scrollHeight - el.clientHeight;
            if (max <= 0)
                return;
            // P9: native scroll converges on the same write seam as feedDelta.
            this.setTargetFromNormalized(clamp01(el.scrollTop / max));
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        this.detachFns.push(() => el.removeEventListener('scroll', onScroll));
    }
    /** Detach DOM listeners. */
    detach() {
        for (const f of this.detachFns)
            f();
        this.detachFns = [];
    }
}
