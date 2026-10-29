/**
 * @lumen/runtime — public API.
 *
 * The browser runtime entry that generated code imports:
 *   import { bootEngine, hydrateIslands } from '@lumen/runtime';
 */

export {
  SCENE_IR_VERSION,
  composedSceneFromIR,
  describeSceneIRError,
  isSceneIR,
  manifestFromAssetRefs,
  type IRAssetRef,
  type IRNode,
  type IRTrack,
  type SceneIR,
} from './ir.js';
export {
  findFirstCameraNodeId,
  resolveCamera,
  type CameraResolutionContext,
} from './camera.js';
export {
  createMotionPolicy,
  type MotionMode,
  type MotionPolicy,
  type MotionPolicyOptions,
} from './motion.js';
export {
  asKernelHandle,
  bootEngine,
  createA11yAnnouncer,
  hydrateIslands,
  parseSceneIR,
  LUMEN_RUNTIME_VERSION,
  VersionSkewError,
  type BootOptions,
  type LumenEngine,
} from './engine.js';
