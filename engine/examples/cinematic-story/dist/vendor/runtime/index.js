/**
 * @lumen/runtime — public API.
 *
 * The browser runtime entry that generated code imports:
 *   import { bootEngine, hydrateIslands } from '@lumen/runtime';
 */
export { SCENE_IR_VERSION, composedSceneFromIR, describeSceneIRError, isSceneIR, manifestFromAssetRefs, } from './ir.js';
export { findFirstCameraNodeId, resolveCamera, } from './camera.js';
export { createMotionPolicy, } from './motion.js';
export { asKernelHandle, bootEngine, createA11yAnnouncer, hydrateIslands, parseSceneIR, LUMEN_RUNTIME_VERSION, VersionSkewError, } from './engine.js';
