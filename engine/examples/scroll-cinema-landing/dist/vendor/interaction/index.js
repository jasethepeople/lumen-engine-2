/**
 * @lumen/interaction — public API.
 */
export { InputNormalizer, createVelocityTracker, estimateVelocity, makeEvent, normalizeDelta, normalizePosition, } from './normalize.js';
export { DEFAULT_THRESHOLDS, GestureRecognizer, createDoubleTapDetector, } from './gestures.js';
export { LumenVirtualScroller } from './scroll.js';
export { BindingRuntime, isStaticFallback, mapInputToOutput, snapValue, stepValues, } from './bindings.js';
export { InteractionManager } from './manager.js';
