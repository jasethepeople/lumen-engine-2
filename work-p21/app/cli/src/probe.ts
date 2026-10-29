/**
 * `lumen-media probe` — ffprobe wrapper printing duration/codec/resolution/fps
 * as JSON. The `duration` value is what feeds `IRAssetRef.duration` and the
 * video AssetEntry duration plumbing (contracts/src/assets.ts).
 */
import { run, requireBinary } from './ffmpeg.js';

export interface ProbeResult {
  /** Absolute or input-relative path that was probed. */
  input: string;
  /** Container duration in seconds (0 when unknown). */
  duration: number;
  /** Primary video codec name, e.g. 'h264'. */
  codec: string;
  /** Pixel width of the primary video stream (0 when unknown). */
  width: number;
  /** Pixel height of the primary video stream (0 when unknown). */
  height: number;
  /** Average frame rate in fps (0 when unknown). */
  fps: number;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

/** Parse an ffprobe rational like "30000/1001"; 0 on garbage. */
export function parseFrameRate(value: string | undefined): number {
  if (!value) return 0;
  const [num, den] = value.split('/');
  const n = Number(num);
  const d = den === undefined ? 1 : Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return n / d;
}

export function buildProbeArgs(input: string): string[] {
  return [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    input,
  ];
}

/** Probe a media file. Throws BinaryNotFoundError when ffprobe is absent. */
export async function probe(input: string, opts: { dryRun?: boolean } = {}): Promise<ProbeResult | null> {
  const bin = requireBinary('ffprobe');
  const res = await run(bin, buildProbeArgs(input), { dryRun: opts.dryRun });
  if (res.dryRun) return null;
  const parsed = JSON.parse(res.stdout) as FfprobeOutput;
  const video = (parsed.streams ?? []).find((s) => s.codec_type === 'video');
  const duration =
    Number(parsed.format?.duration ?? '') ||
    Number(video?.duration ?? '') ||
    0;
  return {
    input,
    duration: Number.isFinite(duration) ? duration : 0,
    codec: video?.codec_name ?? 'unknown',
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: parseFrameRate(video?.avg_frame_rate) || parseFrameRate(video?.r_frame_rate),
  };
}
