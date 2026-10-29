/**
 * @lumen/kernel — public API.
 *
 * Contract types (LifecyclePhase, CapabilityProfile, KernelHandle, …) live in
 * `@lumen/contracts`; this package re-exports the kernel-domain ones for
 * convenience alongside its implementations.
 */
export { createEventBus, } from './event-bus.js';
export { detectCapabilities, detectDpr, detectMaxTextureSize, detectOffscreenCanvas, detectReducedMotion, detectWebGL2, detectWebGPU, fallbackCodecs, probeCodecs, resolveEnvironment, } from './capabilities.js';
export { createScheduler, } from './scheduler.js';
export { createLifecycle } from './lifecycle.js';
export { createPluginRegistry, resolvePluginOrder, } from './plugin.js';
export { KERNEL_ERROR_CODES, createEngineError, guard, guardAsync, isEngineError, toEngineError, } from './errors.js';
export { createKernel } from './kernel.js';
