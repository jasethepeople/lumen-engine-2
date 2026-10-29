/**
 * @lumen/scene — SceneGraph.
 * Maintains the SceneNode hierarchy with parent/child links, world-transform
 * computation with dirty-flag propagation (unchanged subtrees are skipped),
 * structural edits (add/remove/reparent), and JSON-safe serialization.
 */
import { cloneTransform, composeTransform, identityTransform } from './math.js';
export class SceneGraph {
    /** Root nodes, in draw order. */
    roots = [];
    /** id -> node index for O(1) lookup. */
    byId = new Map();
    /** id -> parent id (absent for roots). */
    parentOf = new Map();
    /** id -> cached world transform. */
    world = new Map();
    /** ids whose world transform must be recomputed. */
    dirty = new Set();
    constructor(roots = []) {
        for (const root of roots)
            this.addNode(null, root);
    }
    /** Build a graph from a serialized SceneNode tree (same shape as input; linked in place). */
    static fromTree(roots) {
        return new SceneGraph(roots);
    }
    // -------------------------------------------------------------------------
    // Lookup & traversal
    // -------------------------------------------------------------------------
    has(id) {
        return this.byId.has(id);
    }
    find(id) {
        return this.byId.get(id);
    }
    parentIdOf(id) {
        return this.parentOf.get(id);
    }
    get size() {
        return this.byId.size;
    }
    /** Depth-first traversal in hierarchy order. */
    traverse(visitor) {
        const visit = (node, depth) => {
            if (visitor(node, depth) === false)
                return;
            for (const child of node.children)
                visit(child, depth + 1);
        };
        for (const root of this.roots)
            visit(root, 0);
    }
    /** All node ids in traversal order. */
    ids() {
        const out = [];
        this.traverse((n) => {
            out.push(n.id);
        });
        return out;
    }
    // -------------------------------------------------------------------------
    // Structural edits
    // -------------------------------------------------------------------------
    /**
     * Add a node (and its existing subtree) under `parentId`, or as a root when
     * `parentId` is null. Throws on duplicate ids or missing parent.
     */
    addNode(parentId, node) {
        if (this.byId.has(node.id))
            throw new Error(`SceneGraph: duplicate node id "${node.id}"`);
        let parent;
        if (parentId !== null) {
            parent = this.byId.get(parentId);
            if (!parent)
                throw new Error(`SceneGraph: parent "${parentId}" not found`);
        }
        // Register the whole subtree first so a duplicate deep in it fails cleanly.
        const pending = [];
        const collect = (n, pid) => {
            if (this.byId.has(n.id))
                throw new Error(`SceneGraph: duplicate node id "${n.id}"`);
            pending.push([n, pid]);
            for (const c of n.children)
                collect(c, n.id);
        };
        collect(node, parentId ?? undefined);
        for (const [n, pid] of pending) {
            this.byId.set(n.id, n);
            if (pid !== undefined)
                this.parentOf.set(n.id, pid);
            this.markDirty(n.id);
        }
        if (parent)
            parent.children.push(node);
        else
            this.roots.push(node);
    }
    /** Remove a node and its subtree. Returns the removed node, or undefined. */
    removeNode(id) {
        const node = this.byId.get(id);
        if (!node)
            return undefined;
        // Detach from the parent / root list first (parent link still intact).
        const siblings = this.findSiblings(id);
        if (siblings) {
            const i = siblings.indexOf(node);
            if (i >= 0)
                siblings.splice(i, 1);
        }
        const detach = (n) => {
            this.byId.delete(n.id);
            this.parentOf.delete(n.id);
            this.world.delete(n.id);
            this.dirty.delete(n.id);
            for (const c of n.children)
                detach(c);
        };
        detach(node);
        return node;
    }
    /** Move a node under a new parent (null = root). Subtree comes along. */
    reparent(id, newParentId) {
        const node = this.byId.get(id);
        if (!node)
            throw new Error(`SceneGraph: node "${id}" not found`);
        if (id === newParentId)
            throw new Error('SceneGraph: cannot parent a node to itself');
        if (newParentId !== null) {
            if (!this.byId.has(newParentId))
                throw new Error(`SceneGraph: parent "${newParentId}" not found`);
            if (this.isDescendant(newParentId, id)) {
                throw new Error('SceneGraph: reparent would create a cycle');
            }
        }
        const siblings = this.findSiblings(id);
        if (siblings) {
            const i = siblings.indexOf(node);
            if (i >= 0)
                siblings.splice(i, 1);
        }
        if (newParentId === null) {
            this.parentOf.delete(id);
            this.roots.push(node);
        }
        else {
            this.parentOf.set(id, newParentId);
            this.byId.get(newParentId).children.push(node);
        }
        this.markDirty(id);
    }
    isDescendant(maybeChild, ancestorId) {
        let cur = this.parentOf.get(maybeChild);
        while (cur !== undefined) {
            if (cur === ancestorId)
                return true;
            cur = this.parentOf.get(cur);
        }
        return false;
    }
    findSiblings(id) {
        const pid = this.parentOf.get(id);
        if (pid === undefined)
            return this.roots.includes(this.byId.get(id)) ? this.roots : undefined;
        return this.byId.get(pid)?.children;
    }
    // -------------------------------------------------------------------------
    // Dirty flags & world transforms
    // -------------------------------------------------------------------------
    /** Mark a node dirty; descendants inherit dirtiness at update time. */
    markDirty(id) {
        if (this.byId.has(id))
            this.dirty.add(id);
    }
    /** Convenience: mutate a node's local transform and mark it dirty. */
    setLocalTransform(id, transform) {
        const node = this.byId.get(id);
        if (!node)
            throw new Error(`SceneGraph: node "${id}" not found`);
        node.transform = transform;
        this.markDirty(id);
    }
    /** Cached world transform for a node. Call updateWorldTransforms() first. */
    getWorldTransform(id) {
        return this.world.get(id);
    }
    get dirtyCount() {
        return this.dirty.size;
    }
    /**
     * Recompute world transforms for dirty subtrees only. A subtree is skipped
     * when neither it nor any ancestor is dirty. Returns the number of nodes
     * actually recomputed (useful for tests/profiling).
     */
    updateWorldTransforms() {
        if (this.dirty.size === 0)
            return 0;
        let recomputed = 0;
        const visit = (node, parentWorld, parentDirty) => {
            const isDirty = parentDirty || this.dirty.has(node.id);
            let world;
            if (isDirty) {
                world = composeTransform(parentWorld, node.transform);
                this.world.set(node.id, world);
                recomputed++;
            }
            else {
                world = this.world.get(node.id) ?? composeTransform(parentWorld, node.transform);
            }
            for (const child of node.children)
                visit(child, world, isDirty);
        };
        for (const root of this.roots)
            visit(root, identityTransform(), false);
        this.dirty.clear();
        return recomputed;
    }
    /** Force a full world-transform recomputation. */
    recomputeAll() {
        for (const id of this.byId.keys())
            this.dirty.add(id);
        return this.updateWorldTransforms();
    }
    // -------------------------------------------------------------------------
    // Serialization
    // -------------------------------------------------------------------------
    /**
     * Serialize to a plain JSON-safe SceneNode tree. The graph stores nodes as
     * plain data already, so this is a deep structural clone detached from the
     * live hierarchy.
     */
    serialize() {
        return this.roots.map((r) => cloneNode(r));
    }
    /** Rebuild a graph from serialized JSON (round-trips serialize()). */
    static deserialize(data) {
        return new SceneGraph(data.map((n) => cloneNode(n)));
    }
}
/** Deep clone a SceneNode subtree (plain JSON data only). */
export function cloneNode(node) {
    const out = {
        ...node,
        transform: cloneTransform(node.transform),
        bindings: node.bindings.map((b) => ({ ...b })),
        children: node.children.map((c) => cloneNode(c)),
    };
    if (node.payload !== undefined)
        out.payload = structuredClonePayload(node.payload);
    if (node.meta !== undefined)
        out.meta = { ...node.meta };
    return out;
}
function structuredClonePayload(payload) {
    // Payloads are JSON-safe by contract; structuredClone exists in Node 17+ and workers.
    if (typeof structuredClone === 'function')
        return structuredClone(payload);
    return JSON.parse(JSON.stringify(payload));
}
