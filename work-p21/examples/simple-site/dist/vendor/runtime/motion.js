/**
 * @lumen/runtime — MotionPolicy (P1): the single owner of reduced-motion
 * behavior. Replaces the three independent boolean clamps (frame loop,
 * virtual scroller, binding runtimes) that could drift.
 *
 * Semantics (locked in Phase 2):
 *   - 'continuous': today's behavior, byte-identical (lerp, raw seeks).
 *   - 'reveal': state changes only — time still passes (advanceTime adds dt)
 *     but interpolation cuts to the target and scrub seeks quantize to
 *     section/keyframe boundaries; no smoothing.
 *   - 'static': time-driven tracks hold at t=0; the SSR poster (P17) is the
 *     visible surface.
 *
 * The driver kind never changes (`track.driver` stays 'time'/'scroll'/…);
 * only the interpolation policy switches, per frame, reversible at runtime.
 */
const CONTINUOUS = 'continuous';
/**
 * Resolve the engine-level policy. A wire-declared scene default always wins;
 * absent wire data, reduced motion maps to 'reveal' and full motion to
 * 'continuous' (legacy boolean semantics preserved as derived defaults).
 */
export function createMotionPolicy(options) {
    const mode = options.sceneDefault ?? (options.reducedMotion ? 'reveal' : CONTINUOUS);
    const boundaries = options.boundaries ?? [];
    const quantize = (seconds, bs) => {
        let best = bs[0] ?? 0;
        let bestDist = Math.abs(seconds - best);
        for (const b of bs) {
            const d = Math.abs(seconds - b);
            if (d < bestDist) {
                best = b;
                bestDist = d;
            }
        }
        return best;
    };
    return {
        mode,
        advanceTime(elapsed, dt) {
            return mode === 'static' ? 0 : elapsed + dt;
        },
        interpolate(_current, target, alpha) {
            if (mode === CONTINUOUS)
                return _current + (target - _current) * alpha;
            return target;
        },
        quantizeScrub(seconds, bs = boundaries) {
            if (mode === CONTINUOUS)
                return seconds;
            if (mode === 'static')
                return 0;
            return quantize(seconds, bs);
        },
        trackMode(track) {
            return track.motion ?? mode;
        },
    };
}
