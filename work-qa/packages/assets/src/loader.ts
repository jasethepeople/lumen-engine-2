/**
 * Per-kind asset loaders.
 *
 * Every loader reports LoadState transitions ('queued' -> 'loading' ->
 * 'ready' | 'error') through an optional observer and resolves to a decoded
 * `AssetHandle`. Browser-only decode paths (ImageBitmap, FontFace,
 * HTMLVideoElement, AudioContext) are capability-guarded so the module
 * imports cleanly under Node; in Node, binary kinds resolve to ArrayBuffer
 * handles and decode-only kinds throw `UnsupportedEnvironmentError`.
 */
import type {
  AssetEntry,
  AudioAssetEntry,
  FontAssetEntry,
  ImageAssetEntry,
  LoadState,
  LottieAssetEntry,
  ModelAssetEntry,
  VideoAssetEntry,
} from '@lumen/contracts';
import { resolveAssetUrl } from './manifest.js';

/** Thrown when a loader needs a browser API that is not available. */
export class UnsupportedEnvironmentError extends Error {
  override readonly name = 'UnsupportedEnvironmentError';
}

/** Decoded runtime handle, discriminated by `kind`. */
export type AssetHandle =
  | { kind: 'image'; bitmap: ImageBitmap | null; width: number; height: number; bytes: ArrayBuffer }
  | { kind: 'video'; video: LoadedVideo }
  | { kind: 'model'; buffer: ArrayBuffer; entry: ModelAssetEntry }
  | { kind: 'font'; face: FontFace | null; buffer: ArrayBuffer; entry: FontAssetEntry }
  | { kind: 'lottie'; data: unknown; entry: LottieAssetEntry }
  | { kind: 'audio'; buffer: ArrayBuffer; decoded: AudioBuffer | null; entry: AudioAssetEntry };

export type LoadStateListener = (state: LoadState, error?: Error) => void;

export interface LoadOptions {
  /** CDN base prepended to manifest-relative URLs. */
  cdnBase?: string;
  /** Abort signal propagated to fetch/decode. */
  signal?: AbortSignal;
  /** LoadState transition observer. */
  onState?: LoadStateListener;
  /** Fetch override (testing / custom transport). */
  fetchImpl?: typeof fetch;
}

interface Env {
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}

function makeEnv(opts: LoadOptions): Env {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) {
    throw new UnsupportedEnvironmentError('fetch is not available in this environment');
  }
  const env: Env = { fetchImpl };
  if (opts.signal) env.signal = opts.signal;
  return env;
}

async function fetchBytes(env: Env, url: string): Promise<ArrayBuffer> {
  const init: RequestInit = {};
  if (env.signal) init.signal = env.signal;
  const res = await env.fetchImpl(url, init);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

async function fetchJson(env: Env, url: string): Promise<unknown> {
  const init: RequestInit = {};
  if (env.signal) init.signal = env.signal;
  const res = await env.fetchImpl(url, init);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  return res.json();
}

/** Pick the widest AVIF/WebP srcset URL, else the fallback URL. */
function pickImageUrl(entry: ImageAssetEntry): string {
  const srcset =
    entry.variants.avif?.srcset ?? entry.variants.webp?.srcset ?? null;
  if (srcset) {
    const widths = Object.keys(srcset)
      .map(Number)
      .filter((w) => Number.isFinite(w))
      .sort((a, b) => b - a);
    const widest = widths[0];
    if (widest !== undefined) {
      const url = srcset[widest];
      if (url) return url;
    }
  }
  return entry.variants.fallback.url;
}

/* ------------------------------------------------------------------ video */

/**
 * A loaded video ready for linear playback or frame-accurate scrubbing.
 *
 * Scrub-optimized assets use the progressive MP4/WebM variant with
 * `requestVideoFrameCallback`-driven seeking (HLS latency is unsuitable for
 * scrubbing). HLS playlists are only used for linear playback, via native
 * HLS (Safari) or HLS.js behind a guarded dynamic import.
 */
export interface LoadedVideo {
  /** Underlying media element (browser only). */
  element: HTMLVideoElement | null;
  /** URL actually attached to the element / usable for playback. */
  url: string;
  /** True when an HLS.js instance drives playback. */
  hls: boolean;
  /** Duration in seconds (manifest-declared). */
  duration: number;
  /** Whether the source is an all-keyframe / low-GOP scrub encode. */
  scrubOptimized: boolean;
  /**
   * Seek to `time` (seconds) and resolve once that frame is presented.
   * Uses requestVideoFrameCallback when available; falls back to the
   * `seeked` event. Throws in non-DOM environments.
   */
  seekTo(time: number): Promise<void>;
  /** Subscribe to presented frames (rVFC wrapper). Returns unsubscribe. */
  onFrame(callback: (time: number) => void): () => void;
  /** Detach sources and release the element / HLS instance. */
  dispose(): void;
}

interface HlsLike {
  loadSource(url: string): void;
  attachMedia(el: HTMLMediaElement): void;
  destroy(): void;
}

/** Guarded dynamic import of HLS.js; null when unavailable/unnecessary. */
async function importHls(): Promise<(new () => HlsLike) | null> {
  try {
    // Indirect specifier: hls.js is an optional peer loaded only at runtime
    // on non-Safari browsers; it must not become a compile-time dependency.
    const specifier = 'hls.js';
    const mod = (await import(/* @vite-ignore */ specifier)) as { default?: (new () => HlsLike) & { isSupported?: () => boolean } };
    const Hls = mod.default;
    if (Hls && typeof Hls === 'function') {
      const supported = (Hls as { isSupported?: () => boolean }).isSupported?.() ?? true;
      return supported ? (Hls as new () => HlsLike) : null;
    }
    return null;
  } catch {
    return null; // hls.js not installed — native playback only
  }
}

function canPlayNativeHls(el: HTMLVideoElement): boolean {
  return el.canPlayType('application/vnd.apple.mpegurl') !== '';
}

async function loadVideo(entry: VideoAssetEntry, opts: LoadOptions): Promise<AssetHandle> {
  if (typeof document === 'undefined') {
    throw new UnsupportedEnvironmentError('video loading requires a DOM (HTMLVideoElement)');
  }
  const el = document.createElement('video');
  el.preload = entry.preload === 'lazy' ? 'metadata' : 'auto';
  el.muted = true;
  el.playsInline = true;

  let url: string;
  let hls: HlsLike | null = null;
  let usedHls = false;

  // Scrubbing demands the progressive variant; HLS only for linear playback.
  // Defend against malformed manifests that slipped past validation: only
  // non-empty strings are usable URLs.
  const rawProgressive = entry.variants.mp4?.url ?? entry.variants.webm?.url;
  const progressive =
    typeof rawProgressive === 'string' && rawProgressive !== '' ? rawProgressive : undefined;
  const hlsPlaylist =
    typeof entry.variants.hls?.playlist === 'string' && entry.variants.hls.playlist !== ''
      ? entry.variants.hls.playlist
      : undefined;
  if (entry.scrubOptimized && progressive) {
    url = progressive;
  } else if (entry.variants.hls && !canPlayNativeHls(el)) {
    const HlsCtor = await importHls();
    if (HlsCtor) {
      hls = new HlsCtor();
      usedHls = true;
      url = resolveAssetUrl(hlsPlaylist as string, opts.cdnBase);
    } else {
      url = progressive ?? resolveAssetUrl(hlsPlaylist as string, opts.cdnBase);
    }
  } else {
    url = hlsPlaylist ? resolveAssetUrl(hlsPlaylist, opts.cdnBase) : (progressive as string);
  }
  if (typeof url !== 'string' || url === '') {
    throw new Error(`video asset "${entry.id}": no playable variant URL (mp4/webm/hls all missing or invalid)`);
  }
  if (!url.startsWith('http') && !usedHls && !/^(?:data|blob):/i.test(url)) {
    url = resolveAssetUrl(url, opts.cdnBase);
  }

  if (hls) {
    hls.loadSource(url);
    hls.attachMedia(el);
  } else {
    el.src = url;
  }
  if (entry.poster) el.poster = resolveAssetUrl(entry.poster, opts.cdnBase);

  // Wait for metadata so duration/dimensions are known; tolerate abort.
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('error', onError);
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const onMeta = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error(`video failed to load metadata: ${url}`));
    };
    const onAbort = (): void => {
      cleanup();
      reject(new DOMException('video load aborted', 'AbortError'));
    };
    el.addEventListener('loadedmetadata', onMeta, { once: true });
    el.addEventListener('error', onError, { once: true });
    opts.signal?.addEventListener('abort', onAbort, { once: true });
  });

  const loaded: LoadedVideo = {
    element: el,
    url,
    hls: usedHls,
    duration: entry.duration,
    scrubOptimized: entry.scrubOptimized,
    seekTo(time: number): Promise<void> {
      if (!loaded.element) {
        return Promise.reject(new UnsupportedEnvironmentError('seekTo requires a DOM'));
      }
      const media = loaded.element;
      // Clamp to a finite, in-range time: a NaN assignment to currentTime
      // throws; an unknown (non-finite/<=0) manifest duration disables the
      // upper clamp rather than collapsing every seek to 0.
      const finite = Number.isFinite(time) && time > 0 ? time : 0;
      const d = loaded.duration;
      const target = Number.isFinite(d) && d > 0 ? Math.min(finite, d) : finite;
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`video seekTo(${target}) timed out after 5000ms`));
        }, 5000);
        const cleanup = (): void => {
          clearTimeout(timer);
          media.removeEventListener('error', onMediaError);
        };
        const done = (): void => {
          cleanup();
          resolve();
        };
        const onMediaError = (): void => {
          cleanup();
          reject(new Error('video element error during seekTo'));
        };
        const anyMedia = media as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        };
        media.addEventListener('error', onMediaError, { once: true });
        if (typeof anyMedia.requestVideoFrameCallback === 'function') {
          anyMedia.requestVideoFrameCallback(() => done());
        } else {
          media.addEventListener('seeked', done, { once: true });
        }
        media.currentTime = target;
      });
    },
    onFrame(callback: (time: number) => void): () => void {
      const media = loaded.element;
      if (!media) return () => undefined;
      const anyMedia = media as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
        cancelVideoFrameCallback?: (id: number) => void;
      };
      if (typeof anyMedia.requestVideoFrameCallback !== 'function') {
        return () => undefined; // rVFC unsupported: no-op subscription
      }
      let handle = 0;
      let cancelled = false;
      const tick = (now: number, meta: { mediaTime: number }): void => {
        callback(meta.mediaTime);
        if (!cancelled) handle = anyMedia.requestVideoFrameCallback!(tick);
      };
      handle = anyMedia.requestVideoFrameCallback(tick);
      return () => {
        cancelled = true;
        anyMedia.cancelVideoFrameCallback?.(handle);
      };
    },
    dispose(): void {
      hls?.destroy();
      el.removeAttribute('src');
      el.load();
      loaded.element = null;
    },
  };
  return { kind: 'video', video: loaded };
}

/* --------------------------------------------------------------- loaders */

async function loadImage(entry: ImageAssetEntry, opts: LoadOptions): Promise<AssetHandle> {
  const env = makeEnv(opts);
  const url = resolveAssetUrl(pickImageUrl(entry), opts.cdnBase);
  const bytes = await fetchBytes(env, url);
  let bitmap: ImageBitmap | null = null;
  if (typeof createImageBitmap === 'function' && typeof Blob === 'function') {
    const blob = new Blob([bytes], { type: entry.variants.fallback.mime });
    const bitmapOpts: ImageBitmapOptions = {};
    bitmap = await createImageBitmap(blob, bitmapOpts);
  }
  return { kind: 'image', bitmap, width: entry.width, height: entry.height, bytes };
}

async function loadModel(entry: ModelAssetEntry, opts: LoadOptions): Promise<AssetHandle> {
  const env = makeEnv(opts);
  const buffer = await fetchBytes(env, resolveAssetUrl(entry.url, opts.cdnBase));
  // Parsing (GLTF/GLB, Draco/meshopt decode) is the renderer's job.
  return { kind: 'model', buffer, entry };
}

async function loadFont(entry: FontAssetEntry, opts: LoadOptions): Promise<AssetHandle> {
  const env = makeEnv(opts);
  const url = resolveAssetUrl(entry.url, opts.cdnBase);
  const buffer = await fetchBytes(env, url);
  let face: FontFace | null = null;
  if (typeof FontFace === 'function' && typeof document !== 'undefined' && document.fonts) {
    face = new FontFace(entry.family, buffer, {
      weight: String(entry.weight),
      style: entry.style,
    });
    await face.load();
    document.fonts.add(face);
  }
  return { kind: 'font', face, buffer, entry };
}

async function loadLottie(entry: LottieAssetEntry, opts: LoadOptions): Promise<AssetHandle> {
  const env = makeEnv(opts);
  const data = await fetchJson(env, resolveAssetUrl(entry.url, opts.cdnBase));
  return { kind: 'lottie', data, entry };
}

async function loadAudio(entry: AudioAssetEntry, opts: LoadOptions): Promise<AssetHandle> {
  const env = makeEnv(opts);
  const url = entry.variants.opus?.url ?? entry.variants.aac?.url;
  if (!url) throw new Error(`audio asset "${entry.id}" has no playable variant`);
  const buffer = await fetchBytes(env, resolveAssetUrl(url, opts.cdnBase));
  let decoded: AudioBuffer | null = null;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (Ctor) {
    const ctx = new Ctor();
    try {
      decoded = await ctx.decodeAudioData(buffer.slice(0));
    } catch {
      decoded = null; // codec unsupported; raw buffer still usable by <audio>
    } finally {
      void ctx.close().catch(() => undefined);
    }
  }
  return { kind: 'audio', buffer, decoded, entry };
}

/** Dispatch to the per-kind loader, reporting LoadState transitions. */
export async function loadAsset(entry: AssetEntry, opts: LoadOptions = {}): Promise<AssetHandle> {
  const emit = opts.onState ?? ((): void => undefined);
  emit('queued');
  emit('loading');
  try {
    let handle: AssetHandle;
    switch (entry.kind) {
      case 'image':
        handle = await loadImage(entry, opts);
        break;
      case 'video':
        handle = await loadVideo(entry, opts);
        break;
      case 'model':
        handle = await loadModel(entry, opts);
        break;
      case 'font':
        handle = await loadFont(entry, opts);
        break;
      case 'lottie':
        handle = await loadLottie(entry, opts);
        break;
      case 'audio':
        handle = await loadAudio(entry, opts);
        break;
    }
    emit('ready');
    return handle;
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    emit('error', error);
    throw error;
  }
}
