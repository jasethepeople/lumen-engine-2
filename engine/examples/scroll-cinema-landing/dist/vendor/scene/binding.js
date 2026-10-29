/**
 * @lumen/scene — PropertyBinding evaluator.
 * Applies evaluated timeline values to node properties addressed by dotted
 * paths (e.g. 'transform.position.y', 'payload.material.opacity', 'visible').
 * Driver-agnostic: the caller supplies each track's playhead position, whether
 * it came from wall-clock time, scroll progress, or a pointer.
 */
import { evaluateTrack } from './timeline.js';
/** Axis letter -> tuple index, for vector/quaternion leaves. */
const AXIS_INDEX = { x: 0, y: 1, z: 2, w: 3 };
function segmentKey(container, segment) {
    if (Array.isArray(container) && segment in AXIS_INDEX)
        return AXIS_INDEX[segment];
    return segment;
}
/**
 * Set a value on an object graph via a dotted path. Arrays support numeric
 * indices and axis letters ('transform.position.y' === '...position.1';
 * 'rotationQuat.w' === '...rotationQuat.3').
 * Returns true when the path resolved and the value was written.
 */
export function setByPath(target, path, value) {
    const segments = path.split('.');
    let cur = target;
    for (let i = 0; i < segments.length - 1; i++) {
        if (cur === null || typeof cur !== 'object')
            return false;
        cur = cur[segmentKey(cur, segments[i])];
    }
    if (cur === null || typeof cur !== 'object')
        return false;
    const leaf = segmentKey(cur, segments[segments.length - 1]);
    cur[leaf] = value;
    return true;
}
/** Alias map for common property shorthands. */
const PATH_ALIASES = {
    'material.opacity': 'payload.material.opacity',
};
/** Resolve a binding path to an actual node path, honoring aliases. */
export function resolvePath(path) {
    return PATH_ALIASES[path] ?? path;
}
/**
 * Resolve the playhead position for every track. `time` drives
 * driver:'time' tracks; `drivers` supplies external scalars (scroll progress,
 * pointer position, playback position) keyed by driver name. Tracks whose
 * driver value is unavailable are skipped (returned map has no entry).
 */
export function resolvePlayheads(tracks, time, drivers = {}) {
    const out = new Map();
    for (const track of tracks) {
        const value = track.driver === 'time' ? time : drivers[track.driver];
        if (value !== undefined)
            out.set(track.id, value);
    }
    return out;
}
/**
 * Apply one node's bindings: for each binding, evaluate the referenced track
 * at its playhead and write the value to the node's property path.
 * Binding-level easing overrides per-keyframe easing.
 * Returns the list of property paths that were written (for dirty marking).
 */
export function applyNodeBindings(node, tracksById, playheads, options = {}) {
    const written = [];
    for (const binding of node.bindings) {
        const track = tracksById.get(binding.trackId);
        if (!track)
            continue;
        const t = playheads.get(track.id);
        if (t === undefined)
            continue;
        const value = evaluateTrack(track, t, {
            ...options,
            easing: binding.easing ?? options.easing,
        });
        if (value === undefined)
            continue;
        const path = resolvePath(binding.property);
        if (setByPath(node, path, value))
            written.push(path);
    }
    return written;
}
/**
 * Apply bindings across a whole graph. Every node that carries bindings is
 * updated; nodes whose transform was written are marked dirty so the next
 * updateWorldTransforms() recomputes exactly those subtrees.
 * Returns the ids of nodes that received at least one write.
 */
export function applyBindings(graph, tracks, playheads, options = {}) {
    const tracksById = new Map(tracks.map((t) => [t.id, t]));
    const touched = [];
    graph.traverse((node) => {
        if (node.bindings.length === 0)
            return;
        const written = applyNodeBindings(node, tracksById, playheads, options);
        if (written.length === 0)
            return;
        touched.push(node.id);
        if (written.some((p) => p.startsWith('transform')))
            graph.markDirty(node.id);
    });
    return touched;
}
