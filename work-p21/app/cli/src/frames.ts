/**
 * `lumen-media frames` — mobile frame stack extraction.
 *
 * Emits `frame-00001.webp` / `frame-00001.avif` … at a fixed rate
 * (`-vf fps=N`). Frame stacks are the mobile delivery mode
 * ('frame-stack' in IRAssetVariant): the runtime swaps <img> frames instead
 * of seeking a <video>, which is reliable on iOS/Android.
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  EncoderUnavailableError,
  listEncoders,
  requireBinary,
  run,
  type RunOptions,
} from './ffmpeg.js';

export type FrameFormat = 'webp' | 'avif';

export interface FramesOptions extends RunOptions {
  /** Extraction rate (default 30). */
  fps?: number;
  /** Still-image format (default 'webp'). */
  format?: FrameFormat;
}

export const DEFAULT_FRAMES_FPS = 30;
export const FRAME_BASENAME = 'frame';
export const FRAME_DIGITS = 5;

/** printf-style pattern ffmpeg writes to, e.g. frame-%05d.webp. */
export function framePattern(format: FrameFormat): string {
  return `${FRAME_BASENAME}-%0${FRAME_DIGITS}d.${format}`;
}

/** Glob-ish pattern recorded on the manifest variant (printf form kept). */
export function framePatternForManifest(outDir: string, format: FrameFormat): string {
  return join(outDir, framePattern(format));
}

/**
 * Resolve the encoder for a format. AVIF needs libaom-av1 (or any av1
 * encoder) in this ffmpeg build; when absent we fail with an explanation.
 */
export function resolveFrameEncoder(format: FrameFormat, encoders: readonly string[]): string {
  if (format === 'webp') {
    if (encoders.includes('libwebp')) return 'libwebp';
    // ffmpeg has a native webp encoder (VP8-in-webp); acceptable fallback.
    if (encoders.includes('webp')) return 'webp';
    throw new EncoderUnavailableError(
      'This ffmpeg build has no WebP encoder (need libwebp or the native webp encoder). ' +
        'Rebuild ffmpeg with --enable-libwebp, or use --format avif on a build with libaom-av1.',
    );
  }
  // avif
  if (encoders.includes('libaom-av1')) return 'libaom-av1';
  if (encoders.includes('librav1e')) return 'librav1e';
  if (encoders.includes('libsvtav1')) return 'libsvtav1';
  throw new EncoderUnavailableError(
    'This ffmpeg build has no AV1 encoder, so AVIF frame stacks are unavailable ' +
      '(need libaom-av1, librav1e, or libsvtav1). Rebuild ffmpeg with ' +
      '--enable-libaom, or use --format webp.',
  );
}

export function buildFramesArgs(
  input: string,
  outDir: string,
  format: FrameFormat,
  fps: number,
  encoder: string,
): string[] {
  const args = [
    '-y',
    '-i', input,
    '-vf', `fps=${fps}`,
    '-c:v', encoder,
  ];
  if (format === 'avif') {
    // Still-picture AVIF: all-intra, reasonable quality/size trade-off.
    args.push('-still-picture', '1', '-crf', '30');
  } else if (encoder === 'libwebp') {
    args.push('-quality', '80');
  }
  args.push(join(outDir, framePattern(format)));
  return args;
}

/**
 * Extract the frame stack; returns { pattern, format, fps, frameCount }.
 * On dry-run nothing is written and frameCount is 0.
 */
export async function extractFrames(
  input: string,
  outDir: string,
  opts: FramesOptions = {},
): Promise<{ pattern: string; format: FrameFormat; fps: number; frameCount: number }> {
  const format = opts.format ?? 'webp';
  const fps = opts.fps ?? DEFAULT_FRAMES_FPS;
  mkdirSync(outDir, { recursive: true });
  const pattern = framePatternForManifest(outDir, format);
  if (opts.dryRun) {
    const args = buildFramesArgs(input, outDir, format, fps, format === 'avif' ? 'libaom-av1' : 'libwebp');
    await run('ffmpeg', args, { dryRun: true });
    return { pattern, format, fps, frameCount: 0 };
  }
  const bin = requireBinary('ffmpeg');
  const encoder = resolveFrameEncoder(format, listEncoders());
  await run(bin, buildFramesArgs(input, outDir, format, fps, encoder), opts);
  return { pattern, format, fps, frameCount: countFrames(outDir, format) };
}

/** Count frame-NNNNN.<format> files in a directory (pure; used by manifest too). */
export function countFrames(dir: string, format: string): number {
  return listFrameFiles(dir, format).length;
}

/** List frame files in ascending order. */
export function listFrameFiles(dir: string, format: string): string[] {
  const re = new RegExp(`^${FRAME_BASENAME}-\\d{${FRAME_DIGITS}}\\.${format}$`);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((e) => re.test(e)).sort();
}
