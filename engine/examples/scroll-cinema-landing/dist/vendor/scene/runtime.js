/**
 * @lumen/scene — ComposedScene instantiation.
 * Wires a ComposedScene (graph + tracks + bindings, as produced by the
 * Templates module) into a runtime and provides a pure evaluate() that
 * returns the world state for a given time + external driver scalars.
 */
import { applyBindings, resolvePlayheads } from './binding.js';
import { SceneGraph } from './graph.js';
function collectWorldState(graph, time) {
    const entries = [];
    const byId = new Map();
    const visit = (node, ancestorsVisible) => {
        const visible = ancestorsVisible && node.visible;
        const entry = {
            id: node.id,
            kind: node.kind,
            worldTransform: graph.getWorldTransform(node.id),
            visible,
            layer: node.layer,
            node,
        };
        entries.push(entry);
        byId.set(node.id, entry);
        for (const child of node.children)
            visit(child, visible);
    };
    for (const root of graph.roots)
        visit(root, true);
    return { time, entries, byId };
}
/**
 * Pure evaluation: instantiate a fresh runtime from `scene`, apply all
 * bindings at (time, drivers), recompute world transforms, and return the
 * world state snapshot. The input ComposedScene is never mutated.
 */
export function evaluate(scene, time, drivers = {}, options = {}) {
    const graph = SceneGraph.deserialize(scene.sceneGraph);
    const playheads = resolvePlayheads(scene.tracks, time, drivers);
    applyBindings(graph, scene.tracks, playheads, options);
    graph.recomputeAll();
    return collectWorldState(graph, time);
}
/**
 * Stateful runtime over a ComposedScene: keeps a live SceneGraph so repeated
 * evaluateAt() calls only recompute dirty subtrees. Use this in the render
 * loop; use evaluate() for one-off pure snapshots (codegen, SSR, tests).
 */
export class SceneRuntime {
    graph;
    tracks;
    constructor(scene) {
        this.graph = SceneGraph.deserialize(scene.sceneGraph);
        this.tracks = scene.tracks;
        this.graph.recomputeAll();
    }
    /**
     * Apply bindings at (time, drivers), update dirty world transforms, and
     * return the current world state snapshot.
     */
    evaluateAt(time, drivers = {}, options = {}) {
        const playheads = resolvePlayheads(this.tracks, time, drivers);
        applyBindings(this.graph, this.tracks, playheads, options);
        this.graph.updateWorldTransforms();
        return collectWorldState(this.graph, time);
    }
    /** Serialize the live graph (e.g. for persistence or handoff to a worker). */
    serialize() {
        return this.graph.serialize();
    }
}
/** Instantiate a stateful runtime for a ComposedScene. */
export function createSceneRuntime(scene) {
    return new SceneRuntime(scene);
}
