/**
 * @lumen/app-designer — motion graph model.
 *
 * buildMotionGraph derives a node/edge graph from a validated EngineConfig:
 * scene nodes, driver nodes (time/scroll/pointer/playback/gesture sources),
 * track nodes, and target-node nodes; edges bind driver -> track -> node and
 * interaction bindings -> tracks. reducedMotionOverlay annotates every edge
 * with its reduced-motion fallback behavior, following @lumen/runtime
 * MotionPolicy semantics exactly.
 */

import type { EngineConfig, MotionMode } from '@lumen/contracts';
import { createMotionPolicy, type MotionPolicy } from '@lumen/runtime';

/** Motion graph node kinds. */
export type MotionGraphNodeKind = 'scene' | 'driver' | 'track' | 'node';

export interface MotionGraphNode {
  /** Unique node id in the graph. */
  id: string;
  kind: MotionGraphNodeKind;
  /** Kind-specific detail: driver name, scene id, node kind, etc. */
  detail: Record<string, unknown>;
}

export type MotionGraphEdgeKind =
  | 'drives' // driver -> track
  | 'targets' // track -> scene node
  | 'contains' // scene -> scene node
  | 'binds'; // interaction binding -> track

export interface MotionGraphEdge {
  /** Stable edge id: `${kind}:${from}->${to}`. */
  id: string;
  kind: MotionGraphEdgeKind;
  from: string;
  to: string;
  /** Source interaction id for 'binds' edges. */
  bindingId?: string;
}

/** The derived motion graph. */
export interface MotionGraph {
  nodes: MotionGraphNode[];
  edges: MotionGraphEdge[];
}

/** Reduced-motion behavior annotation attached to an edge. */
export interface ReducedMotionAnnotation {
  /** Effective mode for this edge's track (track/scene override wins). */
  mode: MotionMode;
  /**
   * Fallback behavior per MotionPolicy semantics:
   *  - 'full': continuous — today's behavior, byte-identical.
   *  - 'reveal': state changes only — interpolation cuts to the target and
   *    scrub seeks quantize to section boundaries; time still passes.
   *  - 'static': time-driven tracks hold at t=0; the SSR poster is the
   *    visible surface.
   */
  behavior: 'full' | 'reveal' | 'static';
  /** Whether playback time still advances under this mode. */
  timeAdvances: boolean;
}

export type AnnotatedMotionEdge = MotionGraphEdge & { reducedMotion: ReducedMotionAnnotation };

export interface AnnotatedMotionGraph extends Omit<MotionGraph, 'edges'> {
  edges: AnnotatedMotionEdge[];
  /** The scene-level policy mode the annotations were derived from. */
  policyMode: MotionMode;
}

/**
 * Build the motion graph for a validated EngineConfig.
 * Track ids follow the engine convention `<sceneId>.track`.
 */
export function buildMotionGraph(config: EngineConfig): MotionGraph {
  const nodes = new Map<string, MotionGraphNode>();
  const edges: MotionGraphEdge[] = [];

  const addNode = (node: MotionGraphNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const edgeIds = new Set<string>();
  const addEdge = (kind: MotionGraphEdgeKind, from: string, to: string, bindingId?: string): void => {
    const id = `${kind}:${from}->${to}`;
    if (edgeIds.has(id)) return; // e.g. a scene driver and an interaction share one driver node
    edgeIds.add(id);
    edges.push({ id, kind, from, to, ...(bindingId ? { bindingId } : {}) });
  };

  for (const scene of config.scenes) {
    const trackId = `${scene.id}.track`;
    addNode({ id: scene.id, kind: 'scene', detail: { slot: scene.slot } });
    addNode({ id: `driver:${scene.track.driver}`, kind: 'driver', detail: { driver: scene.track.driver } });
    addNode({
      id: trackId,
      kind: 'track',
      detail: {
        sceneId: scene.id,
        driver: scene.track.driver,
        range: [0, scene.track.durationOrRange],
        ...(scene.a11y.motion ? { motion: scene.a11y.motion } : {}),
      },
    });
    addEdge('drives', `driver:${scene.track.driver}`, trackId);

    for (const node of scene.nodes) {
      addNode({ id: node.id, kind: 'node', detail: { nodeKind: node.kind, sceneId: scene.id } });
      addEdge('contains', scene.id, node.id);
      addEdge('targets', trackId, node.id);
    }
  }

  for (const binding of config.interactions) {
    const driverId = binding.gesture
      ? `driver:gesture:${binding.gesture}`
      : `driver:${binding.source}`;
    addNode({
      id: driverId,
      kind: 'driver',
      detail: { source: binding.source, ...(binding.gesture ? { gesture: binding.gesture } : {}) },
    });
    const trackId = `${binding.scene}.track`;
    addEdge('drives', driverId, trackId);
    addEdge('binds', binding.id, trackId, binding.id);
    addNode({ id: binding.id, kind: 'driver', detail: { interaction: true, source: binding.source } });
  }

  return { nodes: [...nodes.values()], edges };
}

export interface ReducedMotionOverlayOptions {
  /** prefers-reduced-motion capability/override. */
  reducedMotion: boolean;
  /** Wire-declared scene default (wins over the boolean when present). */
  sceneDefault?: MotionMode;
  /** Scene section boundaries (scroll snap points), when known. */
  boundaries?: readonly number[];
}

/**
 * Annotate every edge with its reduced-motion fallback behavior. Uses the
 * engine's createMotionPolicy so the overlay matches runtime behavior
 * exactly: a wire scene default wins; otherwise reduced motion resolves to
 * 'reveal' and full motion to 'continuous'. Track-level overrides (scene
 * a11y.motion, surfaced on track nodes by buildMotionGraph) beat the scene
 * default, mirroring MotionPolicy.trackMode.
 */
export function reducedMotionOverlay(
  graph: MotionGraph,
  options: ReducedMotionOverlayOptions,
): AnnotatedMotionGraph {
  const policy: MotionPolicy = createMotionPolicy({
    reducedMotion: options.reducedMotion,
    ...(options.sceneDefault !== undefined ? { sceneDefault: options.sceneDefault } : {}),
    ...(options.boundaries !== undefined ? { boundaries: options.boundaries } : {}),
  });

  const trackModeByNodeId = new Map<string, MotionMode>();
  for (const node of graph.nodes) {
    if (node.kind === 'track') {
      const override = node.detail['motion'];
      if (override === 'continuous' || override === 'reveal' || override === 'static') {
        trackModeByNodeId.set(node.id, override);
      }
    }
  }

  const modeForEdge = (edge: MotionGraphEdge): MotionMode => {
    const trackNodeId = edge.kind === 'drives' || edge.kind === 'binds' ? edge.to : edge.from;
    // 'contains' edges reference scenes, not tracks: they inherit the policy mode.
    if (edge.kind === 'contains') return policy.mode;
    return trackModeByNodeId.get(trackNodeId) ?? policy.mode;
  };

  return {
    nodes: graph.nodes,
    policyMode: policy.mode,
    edges: graph.edges.map((edge) => {
      const mode = modeForEdge(edge);
      return { ...edge, reducedMotion: annotate(mode) };
    }),
  };
}

/** Map a MotionMode onto its fallback annotation (MotionPolicy semantics). */
export function annotate(mode: MotionMode): ReducedMotionAnnotation {
  switch (mode) {
    case 'continuous':
      return { mode, behavior: 'full', timeAdvances: true };
    case 'reveal':
      return { mode, behavior: 'reveal', timeAdvances: true };
    case 'static':
      return { mode, behavior: 'static', timeAdvances: false };
  }
}
