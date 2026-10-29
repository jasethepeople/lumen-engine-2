/**
 * `lumen-media manifest` — emit an IRAssetRef-compatible JSON asset file
 * (`<name>.asset.json`) plus a merged AssetManifest snippet on stdout.
 *
 * Shapes are owned by contracts: IRAssetRef / IRAssetVariant from
 * contracts/src/ir.ts (P2 wire variants), and the video AssetEntry from
 * contracts/src/assets.ts. Types are imported type-only — the CLI has zero
 * runtime dependencies — and a local structural assert (mirroring
 * packages/assets/src/manifest.ts rules) guards the emitted JSON.
 */
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IRAssetRef, IRAssetVariant } from '@lumen/contracts';
import { countFrames } from './frames.js';
import { probe } from './probe.js';

/** Frame-stack variant: IRAssetVariant plus the stack metadata the runtime needs. */
export interface FrameStackVariant extends IRAssetVariant {
  delivery: 'frame-stack';
  /** Extraction rate the stack was encoded at. */
  fps: number;
  /** Actual frame files found on disk. */
  frameCount: number;
  /** printf-style pattern, e.g. frames/frame-%05d.webp. */
  pattern: string;
}

export interface ManifestInputs {
  /** Logical asset id; also the output filename stem. */
  name: string;
  /** Directory where <name>.asset.json is written (default cwd). */
  outDir?: string;
  /** Scrub MP4 produced by `lumen-media scrub`. */
  scrub?: string;
  /** Directory of frame-NNNNN.<fmt> files produced by `lumen-media frames`. */
  frames?: string;
  /** Frame stack format (default webp). */
  framesFormat?: 'webp' | 'avif';
  /** Frame stack fps recorded on the variant (default 30). */
  framesFps?: number;
  /** Optional HLS playlist. */
  hls?: string;
  /** Explicit duration override (seconds). */
  duration?: number;
  /** Poster URL for the AssetEntry snippet (default: first frame, else ''). */
  poster?: string;
  /** Preload priority for the snippet (default 'lazy'). */
  preload?: 'critical' | 'eager' | 'lazy';
}

function bytesOf(path: string | undefined): number | undefined {
  if (!path) return undefined;
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  webp: 'image/webp',
  avif: 'image/avif',
  m3u8: 'application/vnd.apple.mpegurl',
};

function mimeOf(src: string): string | undefined {
  const ext = src.split('?')[0]!.split('.').pop()?.toLowerCase();
  return ext ? MIME[ext] : undefined;
}

/** Build the IRAssetRef object (never throws on missing probe data). */
export async function buildAssetRef(inputs: ManifestInputs): Promise<IRAssetRef> {
  const variants: IRAssetVariant[] = [];

  if (inputs.scrub) {
    const v: IRAssetVariant = {
      src: inputs.scrub,
      format: 'mp4',
      codec: 'h264',
      delivery: 'gop1',
    };
    const bytes = bytesOf(inputs.scrub);
    if (bytes !== undefined) v.bytes = bytes;
    const mime = mimeOf(inputs.scrub);
    if (mime) (v as IRAssetVariant & { mime?: string }).mime = mime;
    variants.push(v);
  }

  if (inputs.frames) {
    const format = inputs.framesFormat ?? 'webp';
    const fps = inputs.framesFps ?? 30;
    const frameCount = countFrames(inputs.frames, format);
    const pattern = join(inputs.frames, `frame-%05d.${format}`);
    variants.push({
      src: pattern,
      format,
      delivery: 'frame-stack',
      fps,
      frameCount,
      pattern,
      ...(mimeOf(pattern) ? { mime: mimeOf(pattern) } : {}),
    } as FrameStackVariant);
  }

  if (inputs.hls) {
    variants.push({
      src: inputs.hls,
      format: 'hls',
      codec: 'h264',
      delivery: 'hls',
      ...(mimeOf(inputs.hls) ? { mime: mimeOf(inputs.hls) } : {}),
    } as IRAssetVariant);
  }

  // Duration: explicit flag wins; otherwise probe the scrub encode when
  // ffprobe is available; otherwise 0 (unknown per contracts).
  let duration = inputs.duration ?? 0;
  if (inputs.duration === undefined && inputs.scrub) {
    try {
      const info = await probe(inputs.scrub);
      if (info && info.duration > 0) duration = info.duration;
    } catch {
      // ffprobe absent/unreadable — duration stays unknown.
    }
  }

  const ref: IRAssetRef = {
    id: inputs.name,
    src: inputs.scrub ?? inputs.hls ?? (inputs.frames ? join(inputs.frames, `frame-%05d.${inputs.framesFormat ?? 'webp'}`) : ''),
    kind: 'video',
    preload: inputs.preload ?? 'lazy',
    duration,
    variants,
  };
  assertIRAssetRef(ref);
  return ref;
}

/** Video AssetEntry snippet for merging into the build AssetManifest. */
export async function buildManifestSnippet(
  inputs: ManifestInputs,
  ref: IRAssetRef,
): Promise<{ version: 1; generatedAt: string; assets: Record<string, unknown> }> {
  let width = 0;
  let height = 0;
  if (inputs.scrub) {
    try {
      const info = await probe(inputs.scrub);
      if (info) {
        width = info.width;
        height = info.height;
      }
    } catch {
      // probe unavailable — dimensions stay 0.
    }
  }
  const scrubBytes = bytesOf(inputs.scrub) ?? 0;
  const poster =
    inputs.poster ??
    (inputs.frames ? join(inputs.frames, `frame-00001.${inputs.framesFormat ?? 'webp'}`) : '');

  const variants: Record<string, unknown> = {};
  if (inputs.scrub) {
    variants['mp4'] = { url: inputs.scrub, bytes: scrubBytes, codec: 'h264' };
  }
  if (inputs.hls) {
    variants['hls'] = { playlist: inputs.hls, bandwidths: [] };
  }

  const entry = {
    id: ref.id,
    kind: 'video',
    preload: ref.preload ?? 'lazy',
    bytes: scrubBytes,
    duration: ref.duration ?? 0,
    width,
    height,
    poster,
    variants,
    scrubOptimized: inputs.scrub !== undefined,
    irVariants: ref.variants,
  };
  assertVideoAssetEntry(ref.id, entry);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    assets: { [ref.id]: entry },
  };
}

/** Write <name>.asset.json; returns the file path. */
export function writeAssetFile(inputs: ManifestInputs, ref: IRAssetRef): string {
  const dir = inputs.outDir ?? '.';
  const file = join(dir, `${inputs.name}.asset.json`);
  writeFileSync(file, JSON.stringify(ref, null, 2) + '\n');
  return file;
}

/* ------------------------------------------------------------------ */
/* Structural asserts (mirror packages/assets/src/manifest.ts rules).  */
/* ------------------------------------------------------------------ */

export class AssetShapeError extends Error {
  override readonly name = 'AssetShapeError';
}

function fail(path: string, reason: string): never {
  throw new AssetShapeError(`Invalid asset at ${path}: ${reason}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const DELIVERIES = new Set(['progressive', 'gop1', 'frame-stack', 'hls']);

/** Structural check against contracts IRAssetRef / IRAssetVariant (P2). */
export function assertIRAssetRef(ref: unknown): asserts ref is IRAssetRef {
  if (!isRecord(ref)) fail('$', 'must be an object');
  if (typeof ref['id'] !== 'string' || ref['id'] === '') fail('id', 'must be a non-empty string');
  if (typeof ref['src'] !== 'string') fail('src', 'must be a string');
  if (ref['kind'] !== 'video') fail('kind', 'lumen-media emits video assets only');
  if (ref['duration'] !== undefined && (typeof ref['duration'] !== 'number' || ref['duration'] < 0)) {
    fail('duration', 'must be a number >= 0');
  }
  const variants = ref['variants'];
  if (variants !== undefined) {
    if (!Array.isArray(variants)) fail('variants', 'must be an array');
    for (const [i, v] of variants.entries()) {
      const p = `variants[${i}]`;
      if (!isRecord(v)) fail(p, 'must be an object');
      if (typeof v['src'] !== 'string') fail(p, 'src must be a string');
      if (typeof v['delivery'] !== 'string' || !DELIVERIES.has(v['delivery'])) {
        fail(p, `delivery must be one of ${[...DELIVERIES].join(', ')}`);
      }
      if (v['delivery'] === 'frame-stack') {
        if (typeof v['fps'] !== 'number' || v['fps'] <= 0) fail(p, 'frame stacks require fps > 0');
        if (typeof v['frameCount'] !== 'number' || v['frameCount'] < 0) {
          fail(p, 'frame stacks require a frameCount >= 0');
        }
        if (typeof v['pattern'] !== 'string') fail(p, 'frame stacks require a pattern string');
      }
    }
  }
}

/** Structural check against the contracts video AssetEntry shape. */
export function assertVideoAssetEntry(id: string, entry: unknown): void {
  const path = `assets["${id}"]`;
  if (!isRecord(entry)) fail(path, 'entry must be an object');
  if (entry['kind'] !== 'video') fail(path, 'kind must be video');
  if (!['critical', 'eager', 'lazy'].includes(String(entry['preload']))) {
    fail(path, 'preload must be critical|eager|lazy');
  }
  if (typeof entry['bytes'] !== 'number' || entry['bytes'] < 0) fail(path, 'bytes must be >= 0');
  if (typeof entry['poster'] !== 'string') fail(path, 'video entries require poster');
  if (
    typeof entry['duration'] !== 'number' ||
    !Number.isFinite(entry['duration']) ||
    entry['duration'] < 0
  ) {
    fail(path, 'video entries require a finite duration >= 0');
  }
  const v = entry['variants'];
  if (!isRecord(v)) fail(path, 'video entries require variants');
  if (!isRecord(v['hls']) && !isRecord(v['mp4']) && !isRecord(v['webm'])) {
    fail(path, 'video entries require at least one of hls/mp4/webm variants');
  }
  const mp4 = v['mp4'];
  if (mp4 !== undefined && (!isRecord(mp4) || typeof mp4['url'] !== 'string')) {
    fail(path, "video variant 'mp4' requires a string url");
  }
  const hls = v['hls'];
  if (hls !== undefined && (!isRecord(hls) || typeof hls['playlist'] !== 'string')) {
    fail(path, "video variant 'hls' requires a string playlist");
  }
}
