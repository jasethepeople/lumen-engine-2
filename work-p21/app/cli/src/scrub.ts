/**
 * `lumen-media scrub` — keyframe-dense desktop scrub encode.
 *
 * Produces an H.264 MP4 with GOP=1 (every frame an IDR), no B-frames, and
 * faststart so the runtime's scroll-scrub path can seek frame-accurately
 * with minimal decode cost (delivery mode 'gop1' in IRAssetVariant).
 */
import { mkdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { run, requireBinary, type RunOptions } from './ffmpeg.js';

export interface ScrubOptions extends RunOptions {
  /** Max output width in px (default 1920); height scales proportionally. */
  width?: number;
  /** x264 CRF quality (default 23; lower = better/larger). */
  crf?: number;
}

export const DEFAULT_SCRUB_WIDTH = 1920;
export const DEFAULT_SCRUB_CRF = 23;

/** Output filename for a scrub encode inside the -o directory. */
export function scrubOutputName(input: string): string {
  const stem = basename(input, extname(input));
  return `${stem}-scrub.mp4`;
}

export function buildScrubArgs(input: string, output: string, opts: ScrubOptions = {}): string[] {
  const width = opts.width ?? DEFAULT_SCRUB_WIDTH;
  const crf = opts.crf ?? DEFAULT_SCRUB_CRF;
  return [
    '-y',
    '-i', input,
    // Scale down only (never upscale); keep height divisible by 2 for yuv420p.
    '-vf', `scale='min(${width},iw)':-2`,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', String(crf),
    // GOP=1: all keyframes; no B-frames: minimal seek latency.
    '-g', '1',
    '-bf', '0',
    '-pix_fmt', 'yuv420p',
    // Scrub strips audio; the runtime never plays it during scroll.
    '-an',
    '-movflags', '+faststart',
    output,
  ];
}

/** Encode the scrub MP4; returns the output path (or would-be path on dry-run). */
export async function scrub(input: string, outDir: string, opts: ScrubOptions = {}): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const output = join(outDir, scrubOutputName(input));
  const args = buildScrubArgs(input, output, opts);
  if (opts.dryRun) {
    await run('ffmpeg', args, { dryRun: true });
    return output;
  }
  const bin = requireBinary('ffmpeg');
  await run(bin, args, opts);
  return output;
}
