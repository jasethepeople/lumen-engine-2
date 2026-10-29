/**
 * CliExecutor — production AssetJobExecutor that shells out to the repo's
 * `lumen-media` CLI (@lumen/cli, app/cli) for probe/scrub/frames/manifest.
 *
 * Each AssetOp maps to one CLI invocation:
 *   probe       → lumen-media probe <input>            (JSON on stdout)
 *   scrub-mp4   → lumen-media scrub <input> -o <dir>   (GOP-1 H.264 MP4)
 *   frame-stack → lumen-media frames <input> -o <dir> --format webp --fps N
 *   manifest    → lumen-media manifest <name> --scrub … --frames …
 *
 * ffmpeg absence handling: the CLI reports a BinaryNotFoundError on stderr
 * ("not found on PATH"); any op whose invocation fails that way is re-raised
 * as a typed FfmpegUnavailableError so the queue marks the job failed with
 * that reason and keeps draining (graceful degradation). When the op list
 * includes 'probe' it runs first and doubles as the availability check.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FfmpegUnavailableError,
  type AssetJobExecutor,
  type AssetJobInput,
  type AssetOp,
  type AssetOpContext,
  type AssetOpResult,
} from './executor.js';

export interface CliRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable process runner (tests assert argv without spawning). */
export type CliSpawn = (
  command: string,
  args: readonly string[],
) => Promise<CliRunResult>;

export interface CliExecutorOptions {
  /** Absolute path to the compiled lumen-media bin (dist/bin/lumen-media.js). */
  cliPath?: string;
  /** Node executable used to run the CLI (default process.execPath). */
  nodePath?: string;
  /** Injectable spawn (default: node:child_process.spawn wrapper). */
  spawn?: CliSpawn;
  /** FPS tier(s) for frame stacks (default [15, 30] — mobile + desktop). */
  frameFps?: readonly number[];
  /** Frame stack format (default webp). */
  frameFormat?: 'webp' | 'avif';
}

const BINARY_NOT_FOUND_RE = /not found on PATH|ENOENT|spawn .* ENOENT/i;

function defaultSpawn(command: string, args: readonly string[]): Promise<CliRunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = nodeSpawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

/** Best-effort default location of the compiled lumen-media bin. */
export function defaultCliPath(): string {
  const here = fileURLToPath(import.meta.url);
  // dist/cli-executor.js → app/assets/dist → repo root → app/cli/dist/bin
  return resolve(here, '..', '..', '..', '..', 'app', 'cli', 'dist', 'bin', 'lumen-media.js');
}

export class CliExecutor implements AssetJobExecutor {
  private readonly cliPath: string;
  private readonly nodePath: string;
  private readonly spawnFn: CliSpawn;
  private readonly frameFps: readonly number[];
  private readonly frameFormat: 'webp' | 'avif';
  /** Lazily materialized input file per job id. */
  private readonly inputs = new Map<string, string>();

  constructor(options: CliExecutorOptions = {}) {
    this.cliPath = options.cliPath ?? defaultCliPath();
    this.nodePath = options.nodePath ?? process.execPath;
    this.spawnFn = options.spawn ?? defaultSpawn;
    this.frameFps = options.frameFps ?? [15, 30];
    this.frameFormat = options.frameFormat ?? 'webp';
  }

  /** Build the exact argv for a CLI invocation (exposed for tests). */
  buildArgs(op: AssetOp, input: string, outDir: string, name: string): string[][] {
    switch (op) {
      case 'probe':
        return [['probe', input]];
      case 'scrub-mp4':
        return [['scrub', input, '-o', outDir]];
      case 'frame-stack':
        return this.frameFps.map((fps) => [
          'frames',
          input,
          '-o',
          join(outDir, `frames-${fps}fps`),
          '--format',
          this.frameFormat,
          '--fps',
          String(fps),
        ]);
      case 'manifest':
        return [
          [
            'manifest',
            name,
            '--scrub',
            join(outDir, scrubName(input)),
            '--frames',
            join(outDir, `frames-${this.frameFps[this.frameFps.length - 1]}fps`),
            '--frames-format',
            this.frameFormat,
            '-o',
            outDir,
          ],
        ];
    }
  }

  async execute(job: AssetJobInput, op: AssetOp, ctx: AssetOpContext): Promise<AssetOpResult> {
    const input = this.materializeInput(job, ctx.workDir);
    const outDir = ctx.workDir;
    const name = job.id;
    const outputs: Record<string, unknown> = { op };

    for (const args of this.buildArgs(op, input, outDir, name)) {
      const res = await this.run(args);
      if (res.code !== 0) {
        const binary = args[0] === 'probe' ? 'ffprobe' : 'ffmpeg';
        if (BINARY_NOT_FOUND_RE.test(res.stderr)) {
          throw new FfmpegUnavailableError(binary, `lumen-media ${args[0]} failed: ${res.stderr.trim()}`);
        }
        // Any probe failure is treated as potential ffmpeg absence (degrade gracefully).
        if (args[0] === 'probe') {
          throw new FfmpegUnavailableError('ffprobe', `lumen-media probe failed: ${res.stderr.trim()}`);
        }
        throw new Error(`lumen-media ${args[0]} exited ${res.code}: ${res.stderr.trim()}`);
      }
      if (args[0] === 'probe') {
        outputs['probe'] = JSON.parse(res.stdout) as unknown;
      } else if (args[0] === 'manifest') {
        outputs['manifest'] = JSON.parse(res.stdout) as unknown;
      } else {
        const commands = (outputs['commands'] as string[] | undefined) ?? [];
        commands.push(args.join(' '));
        outputs['commands'] = commands;
      }
    }
    if (op === 'scrub-mp4') outputs['scrub'] = join(outDir, scrubName(input));
    if (op === 'frame-stack') {
      outputs['stacks'] = this.frameFps.map((fps) => ({
        fps,
        dir: join(outDir, `frames-${fps}fps`),
        format: this.frameFormat,
      }));
    }
    return { op, ok: true, outputs };
  }

  private async run(args: readonly string[]): Promise<CliRunResult> {
    try {
      return await this.spawnFn(this.nodePath, [this.cliPath, ...args]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (BINARY_NOT_FOUND_RE.test(message)) throw new FfmpegUnavailableError('node', message);
      throw err;
    }
  }

  /** Write the job bytes to a temp input file (once per job). */
  private materializeInput(job: AssetJobInput, workDir: string): string {
    const cached = this.inputs.get(job.id);
    if (cached) return cached;
    const safe = job.sourceName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'input.bin';
    const parent = workDir === '.' ? tmpdir() : resolve(workDir);
    mkdirSync(parent, { recursive: true });
    const dir = mkdtempSync(join(parent, 'lumen-assets-'));
    const input = join(dir, safe);
    writeFileSync(input, job.bytes);
    this.inputs.set(job.id, input);
    return input;
  }
}

/** Mirror of @lumen/cli's scrubOutputName: <stem>-scrub.mp4. */
function scrubName(input: string): string {
  const base = input.split('/').pop() ?? input;
  const stem = base.replace(/\.[^.]+$/, '');
  return `${stem}-scrub.mp4`;
}
