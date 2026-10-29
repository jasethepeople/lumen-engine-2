/**
 * Shared error types for the rendering layer.
 */
/** Typed error raised by renderer construction/selection. Caught by select.ts fallback logic. */
export class RenderingError extends Error {
    module = 'rendering';
    code;
    backend;
    recoverable;
    constructor(code, message, opts) {
        super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
        this.name = 'RenderingError';
        this.code = code;
        this.backend = opts?.backend;
        this.recoverable = opts?.recoverable ?? true;
    }
}
/** True when running in an environment with DOM APIs (browser main thread). */
export function hasDOM() {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
}
/** True when OffscreenCanvas is available (worker rendering path). */
export function hasOffscreenCanvas() {
    return typeof OffscreenCanvas !== 'undefined';
}
let handleSeq = 0;
/** Mint an opaque branded handle string. */
export function mintHandle(prefix) {
    handleSeq += 1;
    return `${prefix}:${handleSeq.toString(36)}`;
}
