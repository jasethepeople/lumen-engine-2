/**
 * @lumen/rendering — public API.
 */

export { RenderingError, type RenderingErrorCode, hasDOM, hasOffscreenCanvas } from './errors.js';
export { DomRenderer, ElementPool, intersectsViewport } from './renderer-dom.js';
export { Canvas2DRenderer, createCanvas, clampDprScale } from './renderer-canvas2d.js';
export {
  WebGLRenderer,
  defaultMeshFactory,
  type MeshFactory,
  type MeshDrawPayload,
  type MeshTransformPayload,
  type ThreeLike,
  type ThreeObject3D,
  type WebGLRendererOptions,
} from './renderer-webgl.js';
export {
  selectRenderer,
  createRenderer,
  FALLBACK_CHAIN,
  type CreateRendererOptions,
} from './select.js';
export {
  AdaptiveQualityController,
  buildLadder,
  LADDER_V1,
  type AdaptiveQualityOptions,
  type QualityRung,
} from './quality.js';
export { drawCallForNode, drawCallsFromWorldState, type SurfaceSize } from './frame-adapter.js';
