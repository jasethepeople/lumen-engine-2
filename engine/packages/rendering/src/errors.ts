/**
 * Shared error types for the rendering layer.
 */

import type { RendererBackend } from '@lumen/contracts';

/** Stable machine-readable error codes raised by @lumen/rendering. */
export type RenderingErrorCode =
  | 'RENDERER_UNAVAILABLE'
  | 'RENDERER_NOT_INITIALIZED'
  | 'UNSUPPORTED_BACKEND'
  | 'INVALID_TARGET';

/** Typed error raised by renderer construction/selection. Caught by select.ts fallback logic. */
export class RenderingError extends Error {
  readonly module = 'rendering';
  readonly code: RenderingErrorCode;
  readonly backend?: RendererBackend;
  readonly recoverable: boolean;

  constructor(code: RenderingErrorCode, message: string, opts?: { backend?: RendererBackend; recoverable?: boolean; cause?: unknown }) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'RenderingError';
    this.code = code;
    this.backend = opts?.backend;
    this.recoverable = opts?.recoverable ?? true;
  }
}

/** True when running in an environment with DOM APIs (browser main thread). */
export function hasDOM(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/** True when OffscreenCanvas is available (worker rendering path). */
export function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

let handleSeq = 0;

/** Mint an opaque branded handle string. */
export function mintHandle<T extends string>(prefix: string): T {
  handleSeq += 1;
  return `${prefix}:${handleSeq.toString(36)}` as T;
}
