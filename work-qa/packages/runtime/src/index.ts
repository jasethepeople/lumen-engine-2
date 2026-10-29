/**
 * @lumen/runtime — public API.
 *
 * The browser runtime entry that generated code imports:
 *   import { bootEngine, hydrateIslands } from '@lumen/runtime';
 */

export {
  SCENE_IR_VERSION,
  composedSceneFromIR,
  isSceneIR,
  manifestFromAssetRefs,
  type IRAssetRef,
  type IRNode,
  type IRTrack,
  type SceneIR,
} from './ir.js';
export {
  asKernelHandle,
  bootEngine,
  hydrateIslands,
  parseSceneIR,
  type BootOptions,
  type LumenEngine,
} from './engine.js';
