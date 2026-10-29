/**
 * @lumen/scene — public API.
 * Scene graph, timeline evaluation, and property binding. Pure math and data
 * structures; no DOM, no runtime dependencies.
 */

export * from './math.js';
export { SceneGraph, cloneNode, type TraverseVisitor } from './graph.js';
export {
  applyEasing,
  cubicBezierEase,
  evaluateTrack,
  evaluateTrackAtProgress,
  interpolateKeyframes,
  resolveKeyframes,
  resolvePlayhead,
  type EvaluateOptions,
  type LoopMode,
  type TrackValue,
} from './timeline.js';
export {
  applyBindings,
  applyNodeBindings,
  resolvePath,
  resolvePlayheads,
  setByPath,
  type Playheads,
} from './binding.js';
export {
  createSceneRuntime,
  evaluate,
  SceneRuntime,
  type DriverValues,
  type WorldState,
  type WorldStateEntry,
} from './runtime.js';
