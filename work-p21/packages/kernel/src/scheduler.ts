/**
 * Cooperative frame scheduler: a single rAF-style loop with prioritized
 * per-frame callbacks and per-frame budget enforcement.
 *
 * Clock and frame-source are injectable so the scheduler is fully testable
 * in Node and runs in workers. Budget overruns are reported through a hook
 * (the kernel wires it to `scheduler:budget-exceeded` on the event bus) and
 * drive an adaptive degradation hook after sustained overruns.
 */

import type { BudgetReport } from '@lumen/contracts';

export type FrameCallback = (frame: FrameInfo) => void;

export interface FrameInfo {
  /** Monotonic timestamp of the frame start (ms). */
  readonly time: number;
  /** Time since the previous frame (ms); 0 on the first frame. */
  readonly delta: number;
  /** Running frame counter (starts at 1). */
  readonly frame: number;
}

export interface FrameTaskOptions {
  /** Lower runs first. Default queue order: input(0) → timeline(10) → scene(20) → render(30) → post(40). */
  readonly priority?: number;
  /** Phase label used in BudgetReport when this task overruns. */
  readonly phase?: string;
}

export type RequestFrame = (cb: (time: number) => void) => number;
export type CancelFrame = (handle: number) => void;

export interface SchedulerHooks {
  /** Invoked for every frame that exceeds the budget. */
  onBudgetExceeded?(report: BudgetReport): void;
  /** Invoked when a single task throws; scheduler keeps running. */
  onTaskError?(error: unknown, phase: string): void;
  /**
   * Adaptive degradation hook: invoked after `degradeAfterFrames`
   * consecutive over-budget frames. Return a new budget to adapt, or void.
   */
  onDegrade?(consecutiveOverruns: number, report: BudgetReport): number | void;
}

export interface SchedulerOptions extends SchedulerHooks {
  /** Per-frame budget in ms. Default 16. */
  budgetMs?: number;
  /** Monotonic clock. Default performance.now / Date.now. */
  now?: () => number;
  /** Frame source. Default requestAnimationFrame when present. */
  requestFrame?: RequestFrame;
  cancelFrame?: CancelFrame;
  /** Consecutive over-budget frames before onDegrade fires. Default 8. */
  degradeAfterFrames?: number;
}

export interface FrameScheduler {
  readonly running: boolean;
  readonly budgetMs: number;
  /** Register a per-frame callback. Returns an unregister function. */
  register(cb: FrameCallback, options?: FrameTaskOptions): () => void;
  start(): void;
  stop(): void;
  /** Adjust the frame budget at runtime (adaptive quality input). */
  setBudget(budgetMs: number): void;
  /** Run exactly one frame synchronously (primarily for tests/SSR). */
  tick(time?: number): void;
}

interface FrameTask extends Required<FrameTaskOptions> {
  readonly cb: FrameCallback;
}

function defaultNow(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

function defaultRequestFrame(): RequestFrame | undefined {
  const raf = (globalThis as { requestAnimationFrame?: RequestFrame }).requestAnimationFrame;
  return typeof raf === 'function' ? raf.bind(globalThis) : undefined;
}

function defaultCancelFrame(): CancelFrame | undefined {
  const caf = (globalThis as { cancelAnimationFrame?: CancelFrame }).cancelAnimationFrame;
  return typeof caf === 'function' ? caf.bind(globalThis) : undefined;
}

export function createScheduler(options: SchedulerOptions = {}): FrameScheduler {
  const now = options.now ?? defaultNow;
  const requestFrame = options.requestFrame ?? defaultRequestFrame();
  const cancelFrame = options.cancelFrame ?? defaultCancelFrame();
  const degradeAfterFrames = options.degradeAfterFrames ?? 8;

  let budgetMs = options.budgetMs ?? 16;
  let running = false;
  let handle: number | null = null;
  let frame = 0;
  let lastTime: number | null = null;
  let consecutiveOverruns = 0;
  let tasks: FrameTask[] = [];

  function runFrame(time: number): void {
    frame += 1;
    const frameStart = now();
    const info: FrameInfo = {
      time,
      // Clamp negative deltas from non-monotonic clocks (injected timers,
      // some background-tab rAF implementations).
      delta: lastTime == null ? 0 : Math.max(0, time - lastTime),
      frame,
    };
    lastTime = time;

    let hottestPhase = 'frame';
    let hottestMs = 0;
    for (const task of tasks) {
      const taskStart = now();
      try {
        task.cb(info);
      } catch (error) {
        options.onTaskError?.(error, task.phase);
      }
      const taskMs = now() - taskStart;
      if (taskMs > hottestMs) {
        hottestMs = taskMs;
        hottestPhase = task.phase;
      }
    }

    const frameMs = now() - frameStart;
    if (frameMs > budgetMs) {
      consecutiveOverruns += 1;
      const report: BudgetReport = Object.freeze({
        frameMs,
        phase: hottestPhase,
        budgetMs,
      });
      options.onBudgetExceeded?.(report);
      if (consecutiveOverruns >= degradeAfterFrames) {
        const next = options.onDegrade?.(consecutiveOverruns, report);
        if (typeof next === 'number' && next > 0) budgetMs = next;
        consecutiveOverruns = 0;
      }
    } else {
      consecutiveOverruns = 0;
    }
  }

  const loop = (time: number): void => {
    if (!running) return;
    runFrame(time);
    // A task may have stopped the scheduler mid-frame (e.g. pause()): do not
    // schedule a trailing callback after stop().
    if (!running) return;
    handle = requestFrame ? requestFrame(loop) : null;
  };

  return {
    get running() {
      return running;
    },
    get budgetMs() {
      return budgetMs;
    },
    register(cb, taskOptions = {}) {
      const task: FrameTask = {
        cb,
        priority: taskOptions.priority ?? 30,
        phase: taskOptions.phase ?? 'frame',
      };
      tasks = [...tasks, task].sort((a, b) => a.priority - b.priority);
      return () => {
        tasks = tasks.filter((t) => t !== task);
      };
    },
    start() {
      if (running) return;
      running = true;
      lastTime = null;
      if (requestFrame) handle = requestFrame(loop);
    },
    stop() {
      running = false;
      if (handle != null && cancelFrame) cancelFrame(handle);
      handle = null;
    },
    setBudget(next) {
      if (next > 0) budgetMs = next;
    },
    tick(time = now()) {
      runFrame(time);
    },
  };
}
