/**
 * Capability detection: produces an immutable `CapabilityProfile` once at boot.
 *
 * All probes are pure functions over an injectable environment, so the module
 * is unit-testable without a DOM and safe to run in workers / SSR (every
 * global access is guarded).
 */

import type { CapabilityProfile, CodecSupport } from '@lumen/contracts';

/** Minimal structural view of the browser globals the probes need. */
export interface CapabilityEnvironment {
  navigator?: {
    deviceMemory?: number;
    hardwareConcurrency?: number;
    gpu?: unknown;
    mediaCapabilities?: {
      decodingInfo(config: Record<string, unknown>): Promise<{
        supported: boolean;
        smooth: boolean;
        powerEfficient: boolean;
      }>;
    };
  };
  window?: {
    devicePixelRatio?: number;
    matchMedia?(query: string): { matches: boolean };
  };
  document?: {
    createElement(tag: string): unknown;
  };
  /** Constructor check for OffscreenCanvas (e.g. globalThis.OffscreenCanvas). */
  OffscreenCanvas?: unknown;
}

const UNSUPPORTED: CodecSupport = Object.freeze({
  supported: false,
  smooth: false,
  powerEfficient: false,
});

/** Resolve the ambient environment, tolerating non-DOM runtimes. */
export function resolveEnvironment(overrides: CapabilityEnvironment = {}): CapabilityEnvironment {
  const g = globalThis as Record<string, unknown>;
  return {
    navigator: overrides.navigator ?? (g.navigator as CapabilityEnvironment['navigator']),
    window: overrides.window ?? (g.window as CapabilityEnvironment['window']),
    document: overrides.document ?? (g.document as CapabilityEnvironment['document']),
    OffscreenCanvas: overrides.OffscreenCanvas ?? g.OffscreenCanvas,
  };
}

/** Probe WebGL2 by attempting to create a context on a throwaway canvas. */
export function detectWebGL2(env: CapabilityEnvironment): boolean {
  try {
    const canvas = env.document?.createElement('canvas') as
      | { getContext?(name: string): unknown }
      | undefined;
    return typeof canvas?.getContext === 'function' && canvas.getContext('webgl2') != null;
  } catch {
    return false;
  }
}

/** Probe WebGPU: presence of navigator.gpu. Adapter request is left to renderers. */
export function detectWebGPU(env: CapabilityEnvironment): boolean {
  return env.navigator?.gpu != null;
}

/** Probe OffscreenCanvas support. */
export function detectOffscreenCanvas(env: CapabilityEnvironment): boolean {
  return env.OffscreenCanvas != null;
}

/** Probe the maximum WebGL texture size; 0 when WebGL is unavailable. */
export function detectMaxTextureSize(env: CapabilityEnvironment): number {
  try {
    const canvas = env.document?.createElement('canvas') as
      | { getContext?(name: string): { getParameter?(p: number): unknown } | null }
      | undefined;
    const gl = canvas?.getContext?.('webgl2') ?? canvas?.getContext?.('webgl');
    // MAX_TEXTURE_SIZE = 0x0D33
    const value = gl?.getParameter?.(0x0d33);
    return typeof value === 'number' ? value : 0;
  } catch {
    return 0;
  }
}

/** Probe `prefers-reduced-motion`. Defaults to false when unprobeable. */
export function detectReducedMotion(env: CapabilityEnvironment): boolean {
  try {
    return env.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  } catch {
    return false;
  }
}

/** Device pixel ratio envelope used by adaptive quality. */
export function detectDpr(env: CapabilityEnvironment): CapabilityProfile['dpr'] {
  const current =
    typeof env.window?.devicePixelRatio === 'number' && env.window.devicePixelRatio > 0
      ? env.window.devicePixelRatio
      : 1;
  return Object.freeze({ min: 1, max: 2, current });
}

/** Static fallback table: codec support when MediaCapabilities is unavailable. */
export function fallbackCodecs(env: CapabilityEnvironment): CapabilityProfile['codecs'] {
  // H.264 + AAC are near-universal; everything else reports unsupported so
  // modules degrade gracefully rather than assume.
  const h264: CodecSupport = Object.freeze({
    supported: env.document != null,
    smooth: false,
    powerEfficient: false,
  });
  return Object.freeze({
    h264,
    hevc: UNSUPPORTED,
    av1: UNSUPPORTED,
    vp9: UNSUPPORTED,
  });
}

const CODEC_PROBES: ReadonlyArray<readonly [keyof CapabilityProfile['codecs'], string]> = [
  ['h264', 'avc1.42001f'],
  ['hevc', 'hvc1.1.6.L120.90'],
  ['av1', 'av01.0.04M.08'],
  ['vp9', 'vp09.00.10.08'],
];

/** Probe video codecs via MediaCapabilities.decodingInfo (guarded + async). */
export async function probeCodecs(
  env: CapabilityEnvironment,
): Promise<CapabilityProfile['codecs']> {
  const mc = env.navigator?.mediaCapabilities;
  if (typeof mc?.decodingInfo !== 'function') return fallbackCodecs(env);

  const entries = await Promise.all(
    CODEC_PROBES.map(async ([name, contentType]) => {
      try {
        const result = await mc.decodingInfo({
          type: 'file',
          video: {
            contentType: `video/mp4; codecs="${contentType}"`,
            width: 1920,
            height: 1080,
            bitrate: 8_000_000,
            framerate: 30,
          },
        });
        const support: CodecSupport = Object.freeze({
          supported: !!result.supported,
          smooth: !!result.smooth,
          powerEfficient: !!result.powerEfficient,
        });
        return [name, support] as const;
      } catch {
        return [name, UNSUPPORTED] as const;
      }
    }),
  );

  const codecs = { ...fallbackCodecs(env) };
  for (const [name, support] of entries) codecs[name] = support;
  return Object.freeze(codecs);
}

/**
 * Full capability probe. Async because codec probing is; everything else is
 * synchronous. Result is deeply frozen and safe to share across modules.
 */
export async function detectCapabilities(
  overrides: CapabilityEnvironment = {},
): Promise<CapabilityProfile> {
  const env = resolveEnvironment(overrides);
  const webgl2 = detectWebGL2(env);
  const [codecs, maxTextureSize] = await Promise.all([
    probeCodecs(env),
    Promise.resolve(webgl2 ? detectMaxTextureSize(env) : 0),
  ]);

  const memory = env.navigator?.deviceMemory;
  const profile: CapabilityProfile = {
    webgl2,
    webgpu: detectWebGPU(env),
    offscreenCanvas: detectOffscreenCanvas(env),
    codecs,
    maxTextureSize,
    deviceMemoryGB: typeof memory === 'number' && memory > 0 ? memory : null,
    reducedMotion: detectReducedMotion(env),
    dpr: detectDpr(env),
  };
  return Object.freeze(profile);
}
