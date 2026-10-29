/**
 * @lumen/scene — Timeline engine.
 * Keyframe evaluation at time t with full EasingName + CubicBezier support,
 * loop modes, and seek/scrub semantics. Driver-agnostic: the caller supplies t
 * (seconds for time/playback tracks, scroll units for scroll/pointer tracks).
 */
import { lerp, lerpArray } from './math.js';
// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------
const NAMED_EASINGS = {
    linear: (t) => t,
    'ease-in': (t) => t * t,
    'ease-out': (t) => 1 - (1 - t) * (1 - t),
    'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
    step: (t) => (t < 1 ? 0 : 1),
};
/**
 * Evaluate a CSS-style cubic-bezier(x1, y1, x2, y2) easing at progress t.
 * Newton–Raphson on the x curve with a bisection fallback.
 */
export function cubicBezierEase(bezier, t) {
    const [x1, y1, x2, y2] = bezier;
    if (t <= 0)
        return 0;
    if (t >= 1)
        return 1;
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sampleX = (u) => ((ax * u + bx) * u + cx) * u;
    const sampleY = (u) => ((ay * u + by) * u + cy) * u;
    const sampleDX = (u) => (3 * ax * u + 2 * bx) * u + cx;
    let u = t;
    for (let i = 0; i < 8; i++) {
        const err = sampleX(u) - t;
        if (Math.abs(err) < 1e-6)
            return sampleY(u);
        const d = sampleDX(u);
        if (Math.abs(d) < 1e-6)
            break;
        u -= err / d;
    }
    // Bisection fallback.
    let lo = 0;
    let hi = 1;
    u = t;
    while (hi - lo > 1e-6) {
        if (sampleX(u) < t)
            lo = u;
        else
            hi = u;
        u = (lo + hi) / 2;
    }
    return sampleY(u);
}
function isCubicBezier(e) {
    return Array.isArray(e);
}
/** Apply an easing (named or cubic bezier) to normalized progress t in [0, 1]. */
export function applyEasing(easing, t) {
    return isCubicBezier(easing) ? cubicBezierEase(easing, t) : NAMED_EASINGS[easing](t);
}
/** Map a raw playhead position onto the track range honoring the loop mode. */
export function resolvePlayhead(raw, range, loop) {
    const [start, end] = range;
    const span = end - start;
    if (span <= 0)
        return start;
    if (loop === 'none')
        return Math.min(Math.max(raw, start), end);
    const local = raw - start;
    if (loop === 'loop') {
        const wrapped = ((local % span) + span) % span;
        return start + wrapped;
    }
    // pingpong
    const period = 2 * span;
    const wrapped = ((local % period) + period) % period;
    return start + (wrapped <= span ? wrapped : period - wrapped);
}
// Cache of flattened keyframe streams per track (P15). Graphs are static
// post-raise, so the flattened stream never needs invalidation.
const flattenedKeys = new WeakMap();
/**
 * Flatten a track's reusable segments (P15) into its keyframe stream.
 * Segment-local key t values in [0, 1] are scaled into the segment window
 * [from, to]; merged with the track's inline keys and stably sorted by t
 * (inline keys first on ties — deterministic merge order). Tracks without
 * segments return their keyframes untouched (legacy path).
 */
export function resolveKeyframes(track) {
    const segments = track.segments;
    if (!segments || segments.length === 0)
        return track.keyframes;
    const cached = flattenedKeys.get(track);
    if (cached)
        return cached;
    const tagged = [];
    track.keyframes.forEach((key, i) => tagged.push({ key, order: i }));
    segments.forEach((seg, s) => {
        const span = seg.to - seg.from;
        seg.keys.forEach((k, i) => {
            const t = seg.from + Math.min(Math.max(k.t, 0), 1) * span;
            tagged.push({ key: { ...k, t }, order: track.keyframes.length + s * seg.keys.length + i });
        });
    });
    tagged.sort((a, b) => a.key.t - b.key.t || a.order - b.order);
    const flat = tagged.map((e) => e.key);
    flattenedKeys.set(track, flat);
    return flat;
}
/**
 * Evaluate a TimelineTrack at playhead position t.
 * - Numbers lerp, numeric arrays lerp component-wise, strings switch discretely
 *   (hold previous keyframe's value until the next keyframe, honoring 'step'
 *   and eased midpoint crossover is intentionally not applied to strings).
 * - Empty tracks return undefined; before/after the keyframe span the value
 *   clamps to the first/last keyframe.
 */
export function evaluateTrack(track, t, options = {}) {
    const keys = resolveKeyframes(track);
    if (keys.length === 0)
        return undefined;
    const time = resolvePlayhead(t, track.range, options.loop ?? 'none');
    if (time <= keys[0].t)
        return keys[0].value;
    const last = keys[keys.length - 1];
    if (time >= last.t)
        return last.value;
    // Binary search for the surrounding keyframe pair.
    let lo = 0;
    let hi = keys.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (keys[mid].t <= time)
            lo = mid;
        else
            hi = mid;
    }
    const a = keys[lo];
    const b = keys[hi];
    return interpolateKeyframes(a, b, time, options.easing);
}
/** Interpolate between two keyframes at absolute time `time`. */
export function interpolateKeyframes(a, b, time, easingOverride) {
    const span = b.t - a.t;
    const raw = span > 0 ? (time - a.t) / span : 0;
    // P15: a binding-level override still wins; a wire bezier beats the named
    // easing; absent both, legacy 'linear'.
    const easing = easingOverride ?? a.easingBezier ?? a.easing ?? 'linear';
    const t = Math.min(Math.max(applyEasing(easing, raw), 0), 1);
    const va = a.value;
    const vb = b.value;
    if (typeof va === 'number' && typeof vb === 'number')
        return lerp(va, vb, t);
    if (Array.isArray(va) && Array.isArray(vb))
        return lerpArray(va, vb, t);
    // Discrete values (strings or type mismatch): step at the eased midpoint.
    return t < 0.5 ? va : vb;
}
/** Scrub helper: evaluate a track at normalized progress p in [0, 1] over its range. */
export function evaluateTrackAtProgress(track, p, options = {}) {
    const [start, end] = track.range;
    return evaluateTrack(track, start + Math.min(Math.max(p, 0), 1) * (end - start), options);
}
