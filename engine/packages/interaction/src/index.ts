/**
 * @lumen/interaction — public API.
 */

export {
  InputNormalizer,
  createVelocityTracker,
  estimateVelocity,
  makeEvent,
  normalizeDelta,
  normalizePosition,
  type NormalizeOptions,
  type NormalizedEventHandler,
  type PointerSample,
  type PointerSampleHandler,
} from './normalize.js';

export {
  DEFAULT_THRESHOLDS,
  GestureRecognizer,
  createDoubleTapDetector,
  type GestureEvent,
  type GestureState,
  type GestureThresholds,
} from './gestures.js';

export { LumenVirtualScroller, type VirtualScrollerOptions } from './scroll.js';

export {
  BindingRuntime,
  isStaticFallback,
  mapInputToOutput,
  snapValue,
  stepValues,
} from './bindings.js';

export { InteractionManager, type DriverMap, type InteractionManagerOptions } from './manager.js';

// Re-export the frozen contract types this package consumes/produces.
export type {
  A11yFallback,
  GestureType,
  InputSource,
  InteractionBinding,
  NormalizedInputEvent,
  SmoothingConfig,
  VirtualScroller,
} from '@lumen/contracts';
