/**
 * `createKernel()` — assembles the event bus, capability detection,
 * lifecycle state machine, frame scheduler, and plugin registry into the
 * public `KernelHandle` plus the internal surfaces other kernel-adjacent
 * modules need (bus, scheduler, plugin registration).
 */

import type {
  CapabilityProfile,
  EngineError,
  EngineEventMap,
  KernelContext,
  KernelHandle,
  LifecyclePhase,
  LumenPlugin,
} from '@lumen/contracts';

import { CapabilityEnvironment, detectCapabilities } from './capabilities.js';
import { KERNEL_ERROR_CODES, toEngineError } from './errors.js';
import { EventBus, createEventBus } from './event-bus.js';
import { Lifecycle, createLifecycle } from './lifecycle.js';
import { PluginRegistry, createPluginRegistry } from './plugin.js';
import { FrameScheduler, SchedulerOptions, createScheduler } from './scheduler.js';

export interface KernelOptions {
  /** Environment overrides for capability probes (testing / workers). */
  environment?: CapabilityEnvironment;
  /** Skip probing and use a precomputed profile. */
  capabilities?: CapabilityProfile;
  /** Scheduler options (budget, clock, frame source). Hooks are wired by the kernel. */
  scheduler?: Omit<SchedulerOptions, 'onBudgetExceeded' | 'onTaskError' | 'onDegrade'> & {
    onDegrade?: SchedulerOptions['onDegrade'];
  };
}

/**
 * The full kernel surface. `KernelHandle` is the frozen public contract;
 * the extra members are how engine internals (and module tests) reach the
 * bus, scheduler, and plugin registry.
 */
export interface Kernel extends KernelHandle {
  readonly bus: EventBus;
  readonly scheduler: FrameScheduler;
  readonly plugins: PluginRegistry;
  readonly lifecycle: Lifecycle;
  /** Alias of start() (contract naming). */
  boot(): Promise<void>;
  /** Alias of pause() (contract naming: suspend the frame loop). */
  suspend(): void;
  registerPlugin(plugin: LumenPlugin): void;
}

export function createKernel(options: KernelOptions = {}): Kernel {
  let capabilities: CapabilityProfile | null = options.capabilities ?? null;

  const bus = createEventBus({
    onListenerError: (error, event) => {
      // Listener failures are isolated by the bus; surface them once here.
      if (event !== 'engine:error') {
        bus.emit('engine:error', toEngineError(error, 'kernel', 'LISTENER_ERROR', true));
      }
    },
  });

  const reportError = (err: EngineError): void => {
    bus.emit('engine:error', err);
  };

  const lifecycle = createLifecycle(bus);

  const scheduler = createScheduler({
    ...options.scheduler,
    onBudgetExceeded: (report) => bus.emit('scheduler:budget-exceeded', report),
    onTaskError: (error, phase) =>
      reportError(toEngineError(error, 'kernel', `SCHEDULER_TASK_${phase.toUpperCase()}`, true)),
  });

  const plugins = createPluginRegistry({ onError: reportError });

  const context: KernelContext = {
    get capabilities() {
      if (!capabilities) {
        throw toEngineError(
          new Error('Capabilities are not available before boot'),
          'kernel',
          KERNEL_ERROR_CODES.BOOT_FAILED,
        );
      }
      return capabilities;
    },
    events: (event, handler) => bus.on(event, handler),
    reportError,
  };

  let startPromise: Promise<void> | null = null;

  async function start(): Promise<void> {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        lifecycle.transition('booting');
        capabilities ??= await detectCapabilities(options.environment);

        lifecycle.transition('loading');
        await plugins.initAll(context);

        lifecycle.transition('ready');
        scheduler.start();
        lifecycle.transition('active');
      } catch (cause) {
        const error = toEngineError(cause, 'kernel', KERNEL_ERROR_CODES.BOOT_FAILED, false);
        reportError(error);
        startPromise = null;
        throw error;
      }
    })();
    return startPromise;
  }

  function pause(): void {
    if (lifecycle.phase !== 'active') return;
    scheduler.stop();
    lifecycle.transition('paused');
  }

  function resume(): void {
    if (lifecycle.phase !== 'paused') return;
    scheduler.start();
    lifecycle.transition('active');
  }

  async function dispose(): Promise<void> {
    if (lifecycle.phase === 'disposed') return;
    scheduler.stop();
    await plugins.disposeAll();
    lifecycle.transition('disposed');
  }

  function registerPlugin(plugin: LumenPlugin): void {
    if (lifecycle.phase !== 'created') {
      throw toEngineError(
        new Error(`Plugins must be registered before boot (phase: ${lifecycle.phase})`),
        'kernel',
        KERNEL_ERROR_CODES.BOOT_FAILED,
      );
    }
    plugins.register(plugin);
  }

  const kernel: Kernel = {
    get phase(): LifecyclePhase {
      return lifecycle.phase;
    },
    get capabilities(): CapabilityProfile {
      return context.capabilities;
    },
    bus,
    scheduler,
    plugins,
    lifecycle,
    start,
    boot: start,
    pause,
    suspend: pause,
    resume,
    dispose,
    registerPlugin,
    on<K extends keyof EngineEventMap>(
      event: K,
      handler: (payload: EngineEventMap[K]) => void,
    ): () => void {
      return bus.on(event, handler);
    },
  };

  return kernel;
}
