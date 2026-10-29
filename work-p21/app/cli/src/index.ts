/**
 * Programmatic entry for @lumen/cli (the `lumen-media` bin is the primary
 * surface; these exports exist so tests and tooling can reuse the logic).
 */
export {
  BinaryNotFoundError,
  EncoderUnavailableError,
  FFmpegError,
  findBinary,
  formatCommand,
  listEncoders,
  requireBinary,
  run,
  type RunOptions,
  type RunResult,
} from './ffmpeg.js';
export { buildScrubArgs, scrub, scrubOutputName, DEFAULT_SCRUB_CRF, DEFAULT_SCRUB_WIDTH } from './scrub.js';
export {
  buildFramesArgs,
  countFrames,
  extractFrames,
  framePattern,
  listFrameFiles,
  resolveFrameEncoder,
  DEFAULT_FRAMES_FPS,
  type FrameFormat,
} from './frames.js';
export { buildProbeArgs, parseFrameRate, probe, type ProbeResult } from './probe.js';
export {
  AssetShapeError,
  assertIRAssetRef,
  assertVideoAssetEntry,
  buildAssetRef,
  buildManifestSnippet,
  writeAssetFile,
  type FrameStackVariant,
  type ManifestInputs,
} from './manifest.js';
