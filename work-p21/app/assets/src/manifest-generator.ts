/**
 * HybridManifestGenerator — turns processed pipeline outputs into the
 * IRAssetVariant array shape consumed by @lumen/assets' pickVariant()
 * (packages/assets/src/variants.ts) and embedded in AssetEntry.irVariants
 * (contracts/src/assets.ts).
 *
 * Hybrid variant set per processed source:
 *   - scrub MP4 variant     (format 'mp4', codec 'h264', delivery 'gop1')
 *   - frame-stack variants  (format 'webp', delivery 'frame-stack') at two
 *     fps tiers (mobile hi/lo)
 *   - poster image          (format 'poster', delivery 'progressive')
 *
 * Output names are content-hashed (SHA-256 truncated to 10 hex chars via
 * @lumen/build's contentHash) so variants are cache-addressable:
 *   <name>.<hash>.mp4, frames-<fps>fps/frame-%05d.webp, <name>.<hash>.webp
 */
import { contentHash } from '@lumen/build';
import type { IRAssetVariant } from '@lumen/contracts';

/** Frame-stack variant shape (mirrors @lumen/cli's FrameStackVariant). */
export interface HybridFrameStackVariant extends IRAssetVariant {
  delivery: 'frame-stack';
  fps: number;
  frameCount: number;
  pattern: string;
}

/** Processed outputs feeding manifest generation (from queue op results). */
export interface ProcessedSource {
  /** Logical asset id / name stem. */
  name: string;
  /** Scrub MP4 bytes (required for the gop1 variant). */
  scrubBytes?: Uint8Array;
  /** Frame stacks per fps tier. */
  frameStacks?: readonly {
    fps: number;
    format?: 'webp' | 'avif';
    frameCount: number;
    /** Combined bytes of the stack (used for hash + byte size). */
    bytes: Uint8Array;
  }[];
  /** Poster image bytes (still frame). */
  posterBytes?: Uint8Array;
  /** Intrinsic width when known (improves pickVariant fitting). */
  width?: number;
  /** URL prefix for emitted src/pattern fields (default 'assets/'). */
  baseUrl?: string;
}

export interface HybridManifest {
  id: string;
  variants: IRAssetVariant[];
  /** Primary (fallback) src — the scrub MP4 when present. */
  src: string;
  /** Total transfer bytes across variants. */
  totalBytes: number;
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webp: 'image/webp',
  avif: 'image/avif',
};

export class HybridManifestGenerator {
  /**
   * Emit the hybrid variant array for one processed source.
   * Throws when there is nothing to emit (no scrub, stacks, or poster).
   */
  generate(source: ProcessedSource): HybridManifest {
    const base = (source.baseUrl ?? 'assets/').replace(/\/?$/, '/');
    const variants: IRAssetVariant[] = [];
    let src = '';

    if (source.scrubBytes && source.scrubBytes.length > 0) {
      const hash = contentHash(source.scrubBytes);
      const url = `${base}${source.name}.${hash}.mp4`;
      const variant: IRAssetVariant = {
        src: url,
        format: 'mp4',
        codec: 'h264',
        delivery: 'gop1',
        bytes: source.scrubBytes.length,
        mime: MIME['mp4'],
      } as IRAssetVariant;
      if (source.width !== undefined) variant.width = source.width;
      variants.push(variant);
      src = url;
    }

    for (const stack of source.frameStacks ?? []) {
      const format = stack.format ?? 'webp';
      const hash = contentHash(stack.bytes);
      const pattern = `${base}${source.name}.${hash}/frames-${stack.fps}fps/frame-%05d.${format}`;
      const variant: HybridFrameStackVariant = {
        src: pattern,
        format,
        delivery: 'frame-stack',
        fps: stack.fps,
        frameCount: stack.frameCount,
        pattern,
        bytes: stack.bytes.length,
        mime: MIME[format],
      } as HybridFrameStackVariant;
      if (source.width !== undefined) variant.width = source.width;
      variants.push(variant);
      if (!src) src = pattern;
    }

    if (source.posterBytes && source.posterBytes.length > 0) {
      const hash = contentHash(source.posterBytes);
      const url = `${base}${source.name}.${hash}.poster.webp`;
      variants.push({
        src: url,
        format: 'poster',
        delivery: 'progressive',
        bytes: source.posterBytes.length,
        mime: MIME['webp'],
        ...(source.width !== undefined ? { width: source.width } : {}),
      } as IRAssetVariant);
      if (!src) src = url;
    }

    if (variants.length === 0) {
      throw new Error(`processed source "${source.name}" has no outputs to manifest`);
    }

    const totalBytes = variants.reduce((sum, v) => sum + (v.bytes ?? 0), 0);
    return { id: source.name, variants, src, totalBytes };
  }
}
