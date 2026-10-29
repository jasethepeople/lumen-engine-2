/**
 * EngineError construction helpers and error-boundary wrappers used to run
 * module/plugin code in a guarded zone: failures are contained, converted to
 * structured EngineErrors, and reported via `engine:error` instead of
 * crashing the engine.
 */

import type { EngineError } from '@lumen/contracts';

export const KERNEL_ERROR_CODES = {
  INVALID_LIFECYCLE_TRANSITION: 'INVALID_LIFECYCLE_TRANSITION',
  PLUGIN_INIT_FAILED: 'PLUGIN_INIT_FAILED',
  PLUGIN_DISPOSE_FAILED: 'PLUGIN_DISPOSE_FAILED',
  PLUGIN_CYCLE: 'PLUGIN_CYCLE',
  PLUGIN_MISSING_DEPENDENCY: 'PLUGIN_MISSING_DEPENDENCY',
  DUPLICATE_PLUGIN: 'DUPLICATE_PLUGIN',
  BOOT_FAILED: 'BOOT_FAILED',
} as const;

export type KernelErrorCode = (typeof KERNEL_ERROR_CODES)[keyof typeof KERNEL_ERROR_CODES];

export function createEngineError(init: EngineError): EngineError {
  const error: EngineError = {
    module: init.module,
    code: init.code,
    recoverable: init.recoverable,
  };
  if ('cause' in init) error.cause = init.cause;
  return Object.freeze(error);
}

export function isEngineError(value: unknown): value is EngineError {
  return (
    typeof value === 'object' &&
    value != null &&
    typeof (value as EngineError).module === 'string' &&
    typeof (value as EngineError).code === 'string' &&
    typeof (value as EngineError).recoverable === 'boolean'
  );
}

/** Normalize an unknown thrown value into a structured EngineError. */
export function toEngineError(
  cause: unknown,
  module: string,
  code: string,
  recoverable = false,
): EngineError {
  if (isEngineError(cause)) return cause;
  return createEngineError({ module, code, recoverable, cause });
}

export interface ErrorBoundaryOptions {
  /** EngineError.module used when wrapping thrown values. */
  module: string;
  /** EngineError.code used when wrapping thrown values. */
  code: string;
  /** Called with the contained EngineError. */
  onError(error: EngineError): void;
  recoverable?: boolean;
}

/**
 * Error boundary around a synchronous body (e.g. a module's init). Returns
 * the body result, or undefined when a contained error occurred.
 */
export function guard<T>(boundary: ErrorBoundaryOptions, body: () => T): T | undefined {
  try {
    return body();
  } catch (cause) {
    boundary.onError(toEngineError(cause, boundary.module, boundary.code, boundary.recoverable));
    return undefined;
  }
}

/** Async variant of {@link guard} — the standard module/plugin init wrapper. */
export async function guardAsync<T>(
  boundary: ErrorBoundaryOptions,
  body: () => T | Promise<T>,
): Promise<T | undefined> {
  try {
    return await body();
  } catch (cause) {
    boundary.onError(toEngineError(cause, boundary.module, boundary.code, boundary.recoverable));
    return undefined;
  }
}
