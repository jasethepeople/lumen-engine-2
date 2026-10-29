/**
 * @lumen/scene — ComposedScene instantiation.
 * Wires a ComposedScene (graph + tracks + bindings, as produced by the
 * Templates module) into a runtime and provides a pure evaluate() that
 * returns the world state for a given time + external driver scalars.
 */

import type { ComposedScene, SceneNode, TimelineTrack, Transform } from '@lumen/contracts';
import { applyBindings, resolvePlayheads } from './binding.js';
import { SceneGraph } from './graph.js';
import type { EvaluateOptions } from './timeline.js';

/** External driver scalars keyed by driver kind (scroll / pointer / playback). */
export type DriverValues = Partial<Record<TimelineTrack['driver'], number>>;

/** World state for one node, consumed by the Rendering layer. */
export interface WorldStateEntry {
  id: string;
  kind: SceneNode['kind'];
  worldTransform: Transform;
  /** Effective visibility (node and all ancestors visible). */
  visible: boolean;
  layer: number;
  node: SceneNode;
}

/** Immutable snapshot returned by evaluate(). */
export interface WorldState {
  time: number;
  /** Entries in depth-first traversal order. */
  entries: WorldStateEntry[];
  /** id -> entry lookup. */
  byId: ReadonlyMap<string, WorldStateEntry>;
}

function collectWorldState(graph: SceneGraph, time: number): WorldState {
  const entries: WorldStateEntry[] = [];
  const byId = new Map<string, WorldStateEntry>();
  const visit = (node: SceneNode, ancestorsVisible: boolean): void => {
    const visible = ancestorsVisible && node.visible;
    const entry: WorldStateEntry = {
      id: node.id,
      kind: node.kind,
      worldTransform: graph.getWorldTransform(node.id)!,
      visible,
      layer: node.layer,
      node,
    };
    entries.push(entry);
    byId.set(node.id, entry);
    for (const child of node.children) visit(child, visible);
  };
  for (const root of graph.roots) visit(root, true);
  return { time, entries, byId };
}

/**
 * Pure evaluation: instantiate a fresh runtime from `scene`, apply all
 * bindings at (time, drivers), recompute world transforms, and return the
 * world state snapshot. The input ComposedScene is never mutated.
 */
export function evaluate(
  scene: ComposedScene,
  time: number,
  drivers: DriverValues = {},
  options: EvaluateOptions = {},
): WorldState {
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
  readonly graph: SceneGraph;
  readonly tracks: readonly TimelineTrack[];

  constructor(scene: ComposedScene) {
    this.graph = SceneGraph.deserialize(scene.sceneGraph);
    this.tracks = scene.tracks;
    this.graph.recomputeAll();
  }

  /**
   * Apply bindings at (time, drivers), update dirty world transforms, and
   * return the current world state snapshot.
   */
  evaluateAt(time: number, drivers: DriverValues = {}, options: EvaluateOptions = {}): WorldState {
    const playheads = resolvePlayheads(this.tracks, time, drivers);
    applyBindings(this.graph, this.tracks, playheads, options);
    this.graph.updateWorldTransforms();
    return collectWorldState(this.graph, time);
  }

  /** Serialize the live graph (e.g. for persistence or handoff to a worker). */
  serialize(): SceneNode[] {
    return this.graph.serialize();
  }
}

/** Instantiate a stateful runtime for a ComposedScene. */
export function createSceneRuntime(scene: ComposedScene): SceneRuntime {
  return new SceneRuntime(scene);
}
