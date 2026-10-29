/**
 * @lumen/kernel — public API.
 *
 * Contract types (LifecyclePhase, CapabilityProfile, KernelHandle, …) live in
 * `@lumen/contracts`; this package re-exports the kernel-domain ones for
 * convenience alongside its implementations.
 */

export type {
  BudgetReport,
  CapabilityProfile,
  CodecSupport,
  EngineError,
  EngineEventMap,
  KernelContext,
  KernelHandle,
  LifecyclePhase,
  LumenPlugin,
} from '@lumen/contracts';

export {
  createEventBus,
  type EventBus,
  type EventBusOptions,
  type EventHandler,
  type EventName,
  type ListenerErrorHandler,
  type WildcardHandler,
} from './event-bus.js';

export {
  detectCapabilities,
  detectDpr,
  detectMaxTextureSize,
  detectOffscreenCanvas,
  detectReducedMotion,
  detectWebGL2,
  detectWebGPU,
  fallbackCodecs,
  probeCodecs,
  resolveEnvironment,
  type CapabilityEnvironment,
} from './capabilities.js';

export {
  createScheduler,
  type FrameCallback,
  type FrameInfo,
  type FrameScheduler,
  type FrameTaskOptions,
  type SchedulerHooks,
  type SchedulerOptions,
} from './scheduler.js';

export { createLifecycle, type Lifecycle } from './lifecycle.js';

export {
  createPluginRegistry,
  resolvePluginOrder,
  type PluginRegistry,
  type PluginRegistryOptions,
} from './plugin.js';

export {
  KERNEL_ERROR_CODES,
  createEngineError,
  guard,
  guardAsync,
  isEngineError,
  toEngineError,
  type ErrorBoundaryOptions,
  type KernelErrorCode,
} from './errors.js';

export { createKernel, type Kernel, type KernelOptions } from './kernel.js';
