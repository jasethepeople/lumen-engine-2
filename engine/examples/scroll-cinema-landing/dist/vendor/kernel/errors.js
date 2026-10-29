/**
 * EngineError construction helpers and error-boundary wrappers used to run
 * module/plugin code in a guarded zone: failures are contained, converted to
 * structured EngineErrors, and reported via `engine:error` instead of
 * crashing the engine.
 */
export const KERNEL_ERROR_CODES = {
    INVALID_LIFECYCLE_TRANSITION: 'INVALID_LIFECYCLE_TRANSITION',
    PLUGIN_INIT_FAILED: 'PLUGIN_INIT_FAILED',
    PLUGIN_DISPOSE_FAILED: 'PLUGIN_DISPOSE_FAILED',
    PLUGIN_CYCLE: 'PLUGIN_CYCLE',
    PLUGIN_MISSING_DEPENDENCY: 'PLUGIN_MISSING_DEPENDENCY',
    DUPLICATE_PLUGIN: 'DUPLICATE_PLUGIN',
    BOOT_FAILED: 'BOOT_FAILED',
};
export function createEngineError(init) {
    const error = {
        module: init.module,
        code: init.code,
        recoverable: init.recoverable,
    };
    if ('cause' in init)
        error.cause = init.cause;
    return Object.freeze(error);
}
export function isEngineError(value) {
    return (typeof value === 'object' &&
        value != null &&
        typeof value.module === 'string' &&
        typeof value.code === 'string' &&
        typeof value.recoverable === 'boolean');
}
/** Normalize an unknown thrown value into a structured EngineError. */
export function toEngineError(cause, module, code, recoverable = false) {
    if (isEngineError(cause))
        return cause;
    return createEngineError({ module, code, recoverable, cause });
}
/**
 * Error boundary around a synchronous body (e.g. a module's init). Returns
 * the body result, or undefined when a contained error occurred.
 */
export function guard(boundary, body) {
    try {
        return body();
    }
    catch (cause) {
        boundary.onError(toEngineError(cause, boundary.module, boundary.code, boundary.recoverable));
        return undefined;
    }
}
/** Async variant of {@link guard} — the standard module/plugin init wrapper. */
export async function guardAsync(boundary, body) {
    try {
        return await body();
    }
    catch (cause) {
        boundary.onError(toEngineError(cause, boundary.module, boundary.code, boundary.recoverable));
        return undefined;
    }
}
