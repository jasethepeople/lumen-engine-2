/**
 * @lumen/assets — asset pipeline: manifest handling, priority preloading,
 * two-tier caching, and per-kind loaders.
 */

export {
  ManifestError,
  normalizeManifest,
  isAssetManifest,
  resolveAssetUrl,
  groupByPriority,
  primaryUrl,
  contentHashKey,
} from './manifest.js';

export {
  UnsupportedEnvironmentError,
  loadAsset,
  type AssetHandle,
  type LoadedVideo,
  type LoadOptions,
  type LoadStateListener,
} from './loader.js';

export {
  AssetPriorityQueue,
  PreloadPauser,
  buildQueue,
  preload,
  type AssetProgressPayload,
  type PreloadOptions,
  type PreloadResult,
  type ProgressEmitter,
} from './preload.js';

export { LruCache, PersistentCache, AssetCache } from './cache.js';

export { pickVariant, type PickVariantOptions } from './variants.js';

export {
  AssetManager,
  createAssetManager,
  type AssetManagerOptions,
  type AssetStats,
} from './manager.js';

// Re-export contract types consumers most often need alongside this API.
export type {
  AssetEntry,
  AssetKind,
  AssetManifest,
  LoadState,
  PreloadStrategy,
} from '@lumen/contracts';
