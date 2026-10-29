/**
 * @lumen/app-assets — hosted asset pipeline for the Lumen Builder.
 *
 * Seam points (read before extending):
 *   - @lumen/cli (app/cli): CliExecutor shells out to the lumen-media bin —
 *     this package does not reimplement ffmpeg invocation logic.
 *   - @lumen/assets (packages/assets): HybridManifestGenerator emits the
 *     IRAssetVariant shape that pickVariant() consumes.
 *   - @lumen/build: content hashing for cache-addressable output names.
 */
export {
  ASSET_OPS,
  FfmpegUnavailableError,
  type AssetJobExecutor,
  type AssetJobInput,
  type AssetOp,
  type AssetOpContext,
  type AssetOpResult,
} from './executor.js';
export {
  AssetUploadQueue,
  type AssetJobProgress,
  type AssetJobRecord,
  type AssetJobState,
  type AssetUploadQueueOptions,
  type ProgressCallback,
} from './queue.js';
export {
  CliExecutor,
  defaultCliPath,
  type CliExecutorOptions,
  type CliRunResult,
  type CliSpawn,
} from './cli-executor.js';
export {
  HybridManifestGenerator,
  type HybridFrameStackVariant,
  type HybridManifest,
  type ProcessedSource,
} from './manifest-generator.js';
export {
  detectDeviceClass,
  pickPipelineProfile,
  type DeviceClass,
  type DeviceClassInput,
  type PipelineProfile,
} from './device.js';
export {
  AssetLibrary,
  DEFAULT_STORAGE_KEY,
  type AssetLibraryOptions,
  type ProcessedAssetRecord,
  type StorageLike,
} from './library.js';
