/**
 * Renderer selection and factory.
 *
 * selectRenderer() is pure decision logic over a CapabilityProfile (unit
 * testable, no DOM). createRenderer() instantiates the chosen backend,
 * catching typed RenderingErrors and walking the fallback chain
 * webgpu → webgl2 → canvas2d → dom.
 */

import type { CapabilityProfile, IRenderer, RendererBackend } from '@lumen/contracts';
import { RenderingError } from './errors.js';
import { DomRenderer } from './renderer-dom.js';
import { Canvas2DRenderer } from './renderer-canvas2d.js';
import { WebGLRenderer, type WebGLRendererOptions } from './renderer-webgl.js';

/** Fallback chain in descending fidelity order. */
export const FALLBACK_CHAIN: readonly RendererBackend[] = ['webgpu', 'webgl2', 'canvas2d', 'dom'];

export interface CreateRendererOptions extends WebGLRendererOptions {
  /** Surface to initialize against (optional; callers may call init() themselves). */
  surface?: HTMLCanvasElement | OffscreenCanvas;
  /** When true, throw instead of falling back if the preferred backend fails. Default false. */
  strict?: boolean;
}

/**
 * Pick the highest-fidelity backend the capability profile supports.
 *
 * @param profile    Detected capabilities from the kernel.
 * @param preference Optional explicit backend request (template hint or user
 *                   override). An unsupported preference falls back to the
 *                   best supported backend, lower in the chain than the
 *                   preference when possible.
 */
export function selectRenderer(profile: CapabilityProfile, preference?: RendererBackend): RendererBackend {
  const supported: Record<RendererBackend, boolean> = {
    webgpu: profile.webgpu,
    webgl2: profile.webgl2,
    // CapabilityProfile has no explicit canvas2d flag: a 2D canvas exists in
    // every environment that can host the engine (HTMLCanvasElement in DOM,
    // OffscreenCanvas in workers when profile.offscreenCanvas is true).
    canvas2d: true,
    dom: true, // DOM renderer is the floor of the chain
  };

  if (preference !== undefined) {
    if (supported[preference]) return preference;
    // Walk down the chain from the preference to the first supported backend.
    const start = FALLBACK_CHAIN.indexOf(preference);
    for (let i = start + 1; i < FALLBACK_CHAIN.length; i += 1) {
      const b = FALLBACK_CHAIN[i]!;
      if (supported[b]) return b;
    }
  }

  for (const b of FALLBACK_CHAIN) {
    if (supported[b]) return b;
  }
  return 'dom';
}

/**
 * Instantiate a renderer for `backend`. When the backend cannot be
 * constructed (e.g. three.js missing for webgl2) and `strict` is false,
 * the next supported backend in the fallback chain is created instead.
 *
 * Note: 'webgpu' is currently a stub — there is no WebGPU IRenderer
 * implementation yet (tracked in README); requesting it falls back to webgl2.
 */
export async function createRenderer(
  backend: RendererBackend,
  opts: CreateRendererOptions = {},
): Promise<IRenderer> {
  let current = backend;
  let lastError: RenderingError | null = null;

  for (;;) {
    try {
      const renderer = await construct(current, opts);
      if (opts.surface !== undefined) await renderer.init(opts.surface);
      return renderer;
    } catch (err) {
      if (err instanceof RenderingError && err.recoverable && !opts.strict) {
        lastError = err;
        const next = FALLBACK_CHAIN[FALLBACK_CHAIN.indexOf(current) + 1];
        if (next === undefined) break;
        current = next;
        continue;
      }
      throw err;
    }
  }
  throw (
    lastError ??
    new RenderingError('UNSUPPORTED_BACKEND', `No renderable backend available starting from '${backend}'.`, {
      backend,
      recoverable: false,
    })
  );
}

async function construct(backend: RendererBackend, opts: CreateRendererOptions): Promise<IRenderer> {
  switch (backend) {
    case 'dom':
      return new DomRenderer();
    case 'canvas2d':
      return new Canvas2DRenderer();
    case 'webgl2':
      return WebGLRenderer.create(opts);
    case 'webgpu':
      // WebGPU stub path: no implementation yet. A future WebGPURenderer
      // (three.js WebGPURenderer + TSL) plugs in here without touching
      // callers — select.ts already prefers it when CapabilityProfile.webgpu
      // is true.
      throw new RenderingError('UNSUPPORTED_BACKEND', 'WebGPU backend is not implemented yet (stub); falling back.', {
        backend: 'webgpu',
        recoverable: true,
      });
  }
}
