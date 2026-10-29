/**
 * AssetUploadQueue — sequential optimization job queue for the builder's
 * hosted asset pipeline.
 *
 * Model:
 *   - jobs are enqueued with an ordered op list and run through a pluggable
 *     executor (one executor call per op);
 *   - a worker pool (default concurrency 1) drains the FIFO; per-op progress
 *     callbacks fire as ops complete;
 *   - job states: pending → running → done | failed; pending jobs can be
 *     canceled, running jobs are canceled cooperatively (the current op
 *     finishes, remaining ops are skipped);
 *   - a failed op fails the job but never the queue (failure isolation);
 *   - retry() re-queues a failed/canceled job from scratch.
 */
import {
  ASSET_OPS,
  FfmpegUnavailableError,
  type AssetJobExecutor,
  type AssetJobInput,
  type AssetOp,
  type AssetOpResult,
} from './executor.js';

export type AssetJobState = 'pending' | 'running' | 'done' | 'failed' | 'canceled';

export interface AssetJobRecord extends AssetJobInput {
  state: AssetJobState;
  /** Index of the op currently executing / next to execute. */
  opIndex: number;
  /** Per-op results, filled in as ops complete. */
  results: AssetOpResult[];
  /** Error message for failed jobs. */
  error?: string;
  /** FfmpegUnavailableError.name when the job failed due to missing ffmpeg. */
  failureReason?: string;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface AssetJobProgress {
  jobId: string;
  state: AssetJobState;
  op: AssetOp;
  opIndex: number;
  totalOps: number;
  result?: AssetOpResult;
}

export type ProgressCallback = (progress: AssetJobProgress) => void;

export interface AssetUploadQueueOptions {
  /** Executor implementation (mock in tests, CliExecutor in production). */
  executor: AssetJobExecutor;
  /** Concurrent workers; default 1 (sequential). */
  concurrency?: number;
  /** Injectable clock (test determinism). */
  clock?: () => number;
  /** Working directory handed to the executor. */
  workDir?: string;
}

export class AssetUploadQueue {
  private readonly executor: AssetJobExecutor;
  private readonly concurrency: number;
  private readonly clock: () => number;
  private readonly workDir: string;
  private readonly jobs = new Map<string, AssetJobRecord>();
  private readonly fifo: string[] = [];
  private readonly callbacks = new Set<ProgressCallback>();
  private readonly aborts = new Map<string, AbortController>();
  private activeWorkers = 0;
  private drainPromise: Promise<void> | null = null;

  constructor(options: AssetUploadQueueOptions) {
    this.executor = options.executor;
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
    this.clock = options.clock ?? Date.now;
    this.workDir = options.workDir ?? '.';
  }

  /** Register a progress callback; returns an unsubscribe function. */
  onProgress(cb: ProgressCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  /** Enqueue a job and start draining. Returns the tracked record (snapshot view via listJobs). */
  enqueue(input: AssetJobInput): AssetJobRecord {
    if (this.jobs.has(input.id)) {
      const existing = this.jobs.get(input.id)!;
      if (existing.state === 'pending' || existing.state === 'running') {
        throw new Error(`job "${input.id}" is already queued`);
      }
      this.jobs.delete(input.id);
    }
    for (const op of input.ops) {
      if (!ASSET_OPS.includes(op)) throw new Error(`unknown asset op "${String(op)}"`);
    }
    const record: AssetJobRecord = {
      ...input,
      ops: [...input.ops],
      state: 'pending',
      opIndex: 0,
      results: [],
      enqueuedAt: this.clock(),
    };
    this.jobs.set(input.id, record);
    this.fifo.push(input.id);
    this.kick();
    return record;
  }

  /** Snapshot of all known jobs in insertion order. */
  listJobs(): AssetJobRecord[] {
    return [...this.jobs.values()].map((j) => ({ ...j, results: [...j.results] }));
  }

  getJob(jobId: string): AssetJobRecord | undefined {
    const j = this.jobs.get(jobId);
    return j ? { ...j, results: [...j.results] } : undefined;
  }

  /**
   * Cancel a job. Pending jobs transition immediately; running jobs are
   * aborted cooperatively — the current op completes, remaining ops skip.
   */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.state === 'pending') {
      this.dequeue(jobId);
      job.state = 'canceled';
      job.finishedAt = this.clock();
      return true;
    }
    if (job.state === 'running') {
      this.aborts.get(jobId)?.abort();
      return true;
    }
    return false;
  }

  /** Re-queue a failed or canceled job from op 0. */
  retry(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.state !== 'failed' && job.state !== 'canceled') return false;
    job.state = 'pending';
    job.opIndex = 0;
    job.results = [];
    job.error = undefined;
    job.failureReason = undefined;
    job.startedAt = undefined;
    job.finishedAt = undefined;
    this.aborts.delete(jobId);
    this.fifo.push(jobId);
    this.kick();
    return true;
  }

  /** Resolves when the queue is fully drained (all jobs terminal). */
  async idle(): Promise<void> {
    while (this.drainPromise) {
      await this.drainPromise;
    }
  }

  private dequeue(jobId: string): void {
    const i = this.fifo.indexOf(jobId);
    if (i >= 0) this.fifo.splice(i, 1);
  }

  private kick(): void {
    if (!this.drainPromise) {
      this.drainPromise = this.drain().finally(() => {
        this.drainPromise = null;
        // A retry/enqueue racing the final finally re-arms draining.
        if (this.fifo.length > 0) this.kick();
      });
    }
  }

  private async drain(): Promise<void> {
    const workers: Promise<void>[] = [];
    while (this.activeWorkers < this.concurrency) {
      const jobId = this.fifo.shift();
      if (jobId === undefined) break;
      this.activeWorkers++;
      workers.push(
        this.runJob(jobId).finally(() => {
          this.activeWorkers--;
        }),
      );
    }
    await Promise.all(workers);
    // New jobs may have been enqueued by retries during the await.
    if (this.fifo.length > 0) return this.drain();
  }

  private async runJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.state !== 'pending') return;
    job.state = 'running';
    job.startedAt = this.clock();
    const controller = new AbortController();
    this.aborts.set(jobId, controller);

    try {
      for (; job.opIndex < job.ops.length; job.opIndex++) {
        if (controller.signal.aborted) {
          job.state = 'canceled';
          job.finishedAt = this.clock();
          return;
        }
        const op = job.ops[job.opIndex]!;
        let result: AssetOpResult;
        try {
          result = await this.executor.execute(job, op, {
            workDir: this.workDir,
            signal: controller.signal,
          });
        } catch (err) {
          result = {
            op,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
          if (err instanceof FfmpegUnavailableError) {
            job.failureReason = err.name;
          }
        }
        job.results.push(result);
        this.emit({ jobId, state: job.state, op, opIndex: job.opIndex, totalOps: job.ops.length, result });
        if (!result.ok) {
          job.state = 'failed';
          job.error = result.error ?? `op "${op}" failed`;
          if (job.failureReason === undefined && result.error?.includes('not available')) {
            job.failureReason = 'FfmpegUnavailableError';
          }
          job.finishedAt = this.clock();
          return;
        }
      }
      job.state = 'done';
      job.finishedAt = this.clock();
      this.emit({
        jobId,
        state: 'done',
        op: job.ops[job.ops.length - 1] ?? 'probe',
        opIndex: job.opIndex,
        totalOps: job.ops.length,
      });
    } finally {
      this.aborts.delete(jobId);
    }
  }

  private emit(progress: AssetJobProgress): void {
    for (const cb of this.callbacks) {
      try {
        cb(progress);
      } catch {
        // Progress observers must never break the queue.
      }
    }
  }
}
