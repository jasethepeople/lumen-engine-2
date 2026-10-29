/**
 * Capability detection: produces an immutable `CapabilityProfile` once at boot.
 *
 * All probes are pure functions over an injectable environment, so the module
 * is unit-testable without a DOM and safe to run in workers / SSR (every
 * global access is guarded).
 */
const UNSUPPORTED = Object.freeze({
    supported: false,
    smooth: false,
    powerEfficient: false,
});
/** Resolve the ambient environment, tolerating non-DOM runtimes. */
export function resolveEnvironment(overrides = {}) {
    const g = globalThis;
    return {
        navigator: overrides.navigator ?? g.navigator,
        window: overrides.window ?? g.window,
        document: overrides.document ?? g.document,
        OffscreenCanvas: overrides.OffscreenCanvas ?? g.OffscreenCanvas,
    };
}
/** Probe WebGL2 by attempting to create a context on a throwaway canvas. */
export function detectWebGL2(env) {
    try {
        const canvas = env.document?.createElement('canvas');
        return typeof canvas?.getContext === 'function' && canvas.getContext('webgl2') != null;
    }
    catch {
        return false;
    }
}
/** Probe WebGPU: presence of navigator.gpu. Adapter request is left to renderers. */
export function detectWebGPU(env) {
    return env.navigator?.gpu != null;
}
/** Probe OffscreenCanvas support. */
export function detectOffscreenCanvas(env) {
    return env.OffscreenCanvas != null;
}
/** Probe the maximum WebGL texture size; 0 when WebGL is unavailable. */
export function detectMaxTextureSize(env) {
    try {
        const canvas = env.document?.createElement('canvas');
        const gl = canvas?.getContext?.('webgl2') ?? canvas?.getContext?.('webgl');
        // MAX_TEXTURE_SIZE = 0x0D33
        const value = gl?.getParameter?.(0x0d33);
        return typeof value === 'number' ? value : 0;
    }
    catch {
        return 0;
    }
}
/** Probe `prefers-reduced-motion`. Defaults to false when unprobeable. */
export function detectReducedMotion(env) {
    try {
        return env.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    }
    catch {
        return false;
    }
}
/** Device pixel ratio envelope used by adaptive quality. */
export function detectDpr(env) {
    const current = typeof env.window?.devicePixelRatio === 'number' && env.window.devicePixelRatio > 0
        ? env.window.devicePixelRatio
        : 1;
    return Object.freeze({ min: 1, max: 2, current });
}
/** Static fallback table: codec support when MediaCapabilities is unavailable. */
export function fallbackCodecs(env) {
    // H.264 + AAC are near-universal; everything else reports unsupported so
    // modules degrade gracefully rather than assume.
    const h264 = Object.freeze({
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
const CODEC_PROBES = [
    ['h264', 'avc1.42001f'],
    ['hevc', 'hvc1.1.6.L120.90'],
    ['av1', 'av01.0.04M.08'],
    ['vp9', 'vp09.00.10.08'],
];
/** Probe video codecs via MediaCapabilities.decodingInfo (guarded + async). */
export async function probeCodecs(env) {
    const mc = env.navigator?.mediaCapabilities;
    if (typeof mc?.decodingInfo !== 'function')
        return fallbackCodecs(env);
    const entries = await Promise.all(CODEC_PROBES.map(async ([name, contentType]) => {
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
            const support = Object.freeze({
                supported: !!result.supported,
                smooth: !!result.smooth,
                powerEfficient: !!result.powerEfficient,
            });
            return [name, support];
        }
        catch {
            return [name, UNSUPPORTED];
        }
    }));
    const codecs = { ...fallbackCodecs(env) };
    for (const [name, support] of entries)
        codecs[name] = support;
    return Object.freeze(codecs);
}
/**
 * Full capability probe. Async because codec probing is; everything else is
 * synchronous. Result is deeply frozen and safe to share across modules.
 */
export async function detectCapabilities(overrides = {}) {
    const env = resolveEnvironment(overrides);
    const webgl2 = detectWebGL2(env);
    const [codecs, maxTextureSize] = await Promise.all([
        probeCodecs(env),
        Promise.resolve(webgl2 ? detectMaxTextureSize(env) : 0),
    ]);
    const memory = env.navigator?.deviceMemory;
    const profile = {
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
