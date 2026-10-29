/**
 * @lumen/app-designer — public API.
 * Advanced motion designer core: timeline editor model with undo, easing
 * library, config<->timeline serialization, motion graph + reduced-motion
 * overlay, and frame-step scrubbing. Framework-free.
 */

export {
  EASING_LIBRARY,
  asEasing,
  NAMED_EASING_NAMES,
  cubicBezierEase,
  evaluateEasing,
  getEasingPreset,
  isBezierEasing,
  isValidBezier,
  isValidEasing,
  type EasingPreset,
} from './easing.js';
export { UndoStack, type UndoStackOptions } from './undo.js';
export {
  TimelineEditor,
  createCameraTrackLanes,
  createTimelineDocument,
  nextKeyframeId,
  type TimelineDocument,
  type TimelineDocumentOptions,
  type TimelineKeyframe,
} from './timeline.js';
export {
  configToTimeline,
  timelineDocToTrack,
  timelineToConfig,
  wrapInEngineConfig,
  type TimelineConfigInput,
  type TimelineConfigOutput,
  type TimelineToConfigOptions,
} from './serialize.js';
export {
  annotate,
  buildMotionGraph,
  reducedMotionOverlay,
  type AnnotatedMotionEdge,
  type AnnotatedMotionGraph,
  type MotionGraph,
  type MotionGraphEdge,
  type MotionGraphEdgeKind,
  type MotionGraphNode,
  type MotionGraphNodeKind,
  type ReducedMotionAnnotation,
  type ReducedMotionOverlayOptions,
} from './graph.js';
export {
  ScrubController,
  quantizeToFrame,
  type ScrubControllerOptions,
  type ScrubSample,
} from './scrub.js';
