#!/usr/bin/env node
/**
 * lumen-media — Lumen engine media pipeline CLI (P7 hybrid variants).
 *
 * Commands:
 *   scrub    <input.mp4> -o out/ [--width 1920] [--crf 23]
 *   frames   <input.mp4> -o out/ [--format webp|avif] [--fps 30]
 *   manifest <name> --scrub out/x.mp4 --frames out/frames/ [--hls s.m3u8]
 *   probe    <input>
 *
 * Global flags: --dry-run (print commands, execute nothing), --timeout-ms.
 * ffmpeg/ffprobe are external binaries; absence is reported up-front with a
 * clear error (probe is optional — manifest degrades gracefully without it).
 */
import { parseArgs } from 'node:util';
import { mkdirSync } from 'node:fs';
import { BinaryNotFoundError, EncoderUnavailableError, FFmpegError, findBinary } from '../ffmpeg.js';
import { scrub } from '../scrub.js';
import { extractFrames, type FrameFormat } from '../frames.js';
import { probe } from '../probe.js';
import { buildAssetRef, buildManifestSnippet, writeAssetFile, type ManifestInputs } from '../manifest.js';

const USAGE = `lumen-media — Lumen engine media pipeline CLI

Usage:
  lumen-media scrub <input.mp4> -o <dir> [--width N] [--crf N]
      Keyframe-dense desktop scrub MP4 (H.264, GOP=1, no B-frames, faststart).

  lumen-media frames <input.mp4> -o <dir> [--format webp|avif] [--fps N]
      Mobile frame stack: frame-00001.<fmt> … at the given rate.

  lumen-media manifest <name> [--scrub f.mp4] [--frames dir/] [--hls s.m3u8]
                      [-o dir] [--duration sec] [--poster url] [--preload P]
      Write <name>.asset.json (IRAssetRef with variants) and print a merged
      AssetManifest snippet (video AssetEntry).

  lumen-media probe <input>
      Print duration/codec/resolution/fps as JSON (fills duration fields).

Global flags:
  --dry-run       Print the ffmpeg/ffprobe commands without executing them.
  --timeout-ms N  Kill any ffmpeg invocation after N ms (default 600000).
  -h, --help      Show this help.
`;

interface GlobalFlags {
  dryRun: boolean;
  timeoutMs?: number;
}

function die(message: string, code = 2): never {
  process.stderr.write(`lumen-media: error: ${message}\n`);
  process.exit(code);
}

function requireOutDir(value: string | undefined): string {
  if (!value) die('missing required -o/--output directory');
  return value;
}

async function cmdScrub(argv: string[], g: GlobalFlags): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      width: { type: 'string' },
      crf: { type: 'string' },
    },
  });
  const input = positionals[0] ?? die('scrub: missing <input.mp4>');
  const outDir = requireOutDir(values.output);
  const width = values.width !== undefined ? Number(values.width) : undefined;
  const crf = values.crf !== undefined ? Number(values.crf) : undefined;
  if (width !== undefined && (!Number.isInteger(width) || width <= 0)) die('scrub: --width must be a positive integer');
  if (crf !== undefined && (!Number.isFinite(crf) || crf < 0 || crf > 51)) die('scrub: --crf must be 0..51');
  if (!g.dryRun && findBinary('ffmpeg') === null) throw new BinaryNotFoundError('ffmpeg');
  const out = await scrub(input, outDir, { width, crf, dryRun: g.dryRun, timeoutMs: g.timeoutMs });
  process.stderr.write(`${g.dryRun ? '[dry-run] would write' : 'wrote'} ${out}\n`);
}

async function cmdFrames(argv: string[], g: GlobalFlags): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      format: { type: 'string' },
      fps: { type: 'string' },
    },
  });
  const input = positionals[0] ?? die('frames: missing <input.mp4>');
  const outDir = requireOutDir(values.output);
  const format = (values.format ?? 'webp') as FrameFormat;
  if (format !== 'webp' && format !== 'avif') die(`frames: --format must be webp or avif (got "${values.format}")`);
  const fps = values.fps !== undefined ? Number(values.fps) : undefined;
  if (fps !== undefined && (!Number.isFinite(fps) || fps <= 0)) die('frames: --fps must be > 0');
  if (!g.dryRun && findBinary('ffmpeg') === null) throw new BinaryNotFoundError('ffmpeg');
  const res = await extractFrames(input, outDir, { format, fps, dryRun: g.dryRun, timeoutMs: g.timeoutMs });
  process.stderr.write(
    g.dryRun
      ? `[dry-run] would write ${res.pattern}\n`
      : `wrote ${res.frameCount} frames (${res.pattern})\n`,
  );
}

async function cmdManifest(argv: string[], _g: GlobalFlags): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      scrub: { type: 'string' },
      frames: { type: 'string' },
      'frames-format': { type: 'string' },
      'frames-fps': { type: 'string' },
      hls: { type: 'string' },
      duration: { type: 'string' },
      poster: { type: 'string' },
      preload: { type: 'string' },
    },
  });
  const name = positionals[0] ?? die('manifest: missing <name>');
  if (!values.scrub && !values.frames && !values.hls) {
    die('manifest: provide at least one of --scrub, --frames, --hls');
  }
  const preload = values.preload ?? 'lazy';
  if (!['critical', 'eager', 'lazy'].includes(preload)) die('manifest: --preload must be critical|eager|lazy');
  const framesFormat = values['frames-format'] ?? 'webp';
  if (framesFormat !== 'webp' && framesFormat !== 'avif') die('manifest: --frames-format must be webp|avif');
  const inputs: ManifestInputs = {
    name,
    outDir: values.output,
    scrub: values.scrub,
    frames: values.frames,
    framesFormat,
    framesFps: values['frames-fps'] !== undefined ? Number(values['frames-fps']) : undefined,
    hls: values.hls,
    duration: values.duration !== undefined ? Number(values.duration) : undefined,
    poster: values.poster,
    preload: preload as ManifestInputs['preload'],
  };
  if (inputs.duration !== undefined && (!Number.isFinite(inputs.duration) || inputs.duration < 0)) {
    die('manifest: --duration must be a number >= 0');
  }
  if (inputs.outDir) mkdirSync(inputs.outDir, { recursive: true });
  const ref = await buildAssetRef(inputs);
  const file = writeAssetFile(inputs, ref);
  const snippet = await buildManifestSnippet(inputs, ref);
  process.stderr.write(`wrote ${file}\n`);
  process.stdout.write(`${JSON.stringify(snippet, null, 2)}\n`);
}

async function cmdProbe(argv: string[], g: GlobalFlags): Promise<void> {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} });
  const input = positionals[0] ?? die('probe: missing <input>');
  if (g.dryRun) {
    // Print the ffprobe command without requiring the binary.
    const { buildProbeArgs } = await import('../probe.js');
    const { run } = await import('../ffmpeg.js');
    await run('ffprobe', buildProbeArgs(input), { dryRun: true });
    return;
  }
  const info = await probe(input);
  process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  // Global flags may appear anywhere after the command.
  const rest: string[] = [];
  const g: GlobalFlags = { dryRun: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') g.dryRun = true;
    else if (a === '--timeout-ms') g.timeoutMs = Number(argv[++i]);
    else rest.push(a);
  }
  switch (command) {
    case 'scrub':
      await cmdScrub(rest, g);
      return;
    case 'frames':
      await cmdFrames(rest, g);
      return;
    case 'manifest':
      await cmdManifest(rest, g);
      return;
    case 'probe':
      await cmdProbe(rest, g);
      return;
    default:
      process.stderr.write(USAGE);
      die(`unknown command "${command}"`);
  }
}

main().catch((err: unknown) => {
  if (err instanceof BinaryNotFoundError || err instanceof EncoderUnavailableError) {
    die(err.message, 3);
  }
  if (err instanceof FFmpegError) {
    die(err.message, 4);
  }
  die(err instanceof Error ? err.message : String(err), 1);
});
