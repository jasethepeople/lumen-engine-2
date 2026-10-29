/**
 * Executor abstraction for the asset upload queue.
 *
 * The queue is executor-agnostic: tests inject a mock executor, production
 * wiring uses CliExecutor (cli-executor.ts) which shells out to the repo's
 * `lumen-media` CLI (@lumen/cli). One executor call handles one AssetOp so
 * the queue can report per-op progress and isolate per-op failures.
 */

/** Optimization operations a job can request (order is preserved). */
export type AssetOp = 'scrub-mp4' | 'frame-stack' | 'probe' | 'manifest';

export const ASSET_OPS: readonly AssetOp[] = ['scrub-mp4', 'frame-stack', 'probe', 'manifest'];

/** Job payload accepted by AssetUploadQueue.enqueue(). */
export interface AssetJobInput {
  id: string;
  kind: 'video' | 'image';
  /** Original file name (used to derive output names). */
  sourceName: string;
  /** Raw source bytes. */
  bytes: Uint8Array;
  /** Operations to run, in declaration order. */
  ops: readonly AssetOp[];
}

/** Result of a single executed op. */
export interface AssetOpResult {
  op: AssetOp;
  ok: boolean;
  /** Op-specific outputs (output paths, probe data, manifest JSON, …). */
  outputs?: Record<string, unknown>;
  /** Error message when ok === false. */
  error?: string;
}

/** Per-call execution context handed to the executor. */
export interface AssetOpContext {
  /** Working directory the executor may use for temp inputs/outputs. */
  workDir: string;
  /** Cancellation signal (cooperative; running ops may still complete). */
  signal: AbortSignal;
}

/** Pluggable executor: one call per op. Must throw or return ok:false on failure. */
export interface AssetJobExecutor {
  execute(job: AssetJobInput, op: AssetOp, ctx: AssetOpContext): Promise<AssetOpResult>;
}

/**
 * ffmpeg/ffprobe is not installed on the host. The queue marks the job
 * failed with this reason and keeps processing subsequent jobs — absence of
 * ffmpeg is an environment condition, not a queue-fatal error.
 */
export class FfmpegUnavailableError extends Error {
  override readonly name = 'FfmpegUnavailableError';
  constructor(
    /** Which binary is missing ('ffmpeg' | 'ffprobe'). */
    readonly binary: string,
    message?: string,
  ) {
    super(
      message ??
        `Required binary "${binary}" is not available; install ffmpeg to enable media optimization.`,
    );
  }
}
