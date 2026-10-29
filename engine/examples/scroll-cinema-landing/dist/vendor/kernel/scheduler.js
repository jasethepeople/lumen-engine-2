/**
 * Cooperative frame scheduler: a single rAF-style loop with prioritized
 * per-frame callbacks and per-frame budget enforcement.
 *
 * Clock and frame-source are injectable so the scheduler is fully testable
 * in Node and runs in workers. Budget overruns are reported through a hook
 * (the kernel wires it to `scheduler:budget-exceeded` on the event bus) and
 * drive an adaptive degradation hook after sustained overruns.
 */
function defaultNow() {
    const perf = globalThis.performance;
    return typeof perf?.now === 'function' ? perf.now() : Date.now();
}
function defaultRequestFrame() {
    const raf = globalThis.requestAnimationFrame;
    return typeof raf === 'function' ? raf.bind(globalThis) : undefined;
}
function defaultCancelFrame() {
    const caf = globalThis.cancelAnimationFrame;
    return typeof caf === 'function' ? caf.bind(globalThis) : undefined;
}
export function createScheduler(options = {}) {
    const now = options.now ?? defaultNow;
    const requestFrame = options.requestFrame ?? defaultRequestFrame();
    const cancelFrame = options.cancelFrame ?? defaultCancelFrame();
    const degradeAfterFrames = options.degradeAfterFrames ?? 8;
    let budgetMs = options.budgetMs ?? 16;
    let running = false;
    let handle = null;
    let frame = 0;
    let lastTime = null;
    let consecutiveOverruns = 0;
    let tasks = [];
    function runFrame(time) {
        frame += 1;
        const frameStart = now();
        const info = {
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
            }
            catch (error) {
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
            const report = Object.freeze({
                frameMs,
                phase: hottestPhase,
                budgetMs,
            });
            options.onBudgetExceeded?.(report);
            if (consecutiveOverruns >= degradeAfterFrames) {
                const next = options.onDegrade?.(consecutiveOverruns, report);
                if (typeof next === 'number' && next > 0)
                    budgetMs = next;
                consecutiveOverruns = 0;
            }
        }
        else {
            consecutiveOverruns = 0;
        }
    }
    const loop = (time) => {
        if (!running)
            return;
        runFrame(time);
        // A task may have stopped the scheduler mid-frame (e.g. pause()): do not
        // schedule a trailing callback after stop().
        if (!running)
            return;
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
            const task = {
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
            if (running)
                return;
            running = true;
            lastTime = null;
            if (requestFrame)
                handle = requestFrame(loop);
        },
        stop() {
            running = false;
            if (handle != null && cancelFrame)
                cancelFrame(handle);
            handle = null;
        },
        setBudget(next) {
            if (next > 0)
                budgetMs = next;
        },
        tick(time = now()) {
            runFrame(time);
        },
    };
}
