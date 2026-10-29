/**
 * Thin spawn wrapper around external ffmpeg/ffprobe binaries.
 *
 * Design notes:
 *  - zero runtime deps: only node:child_process / node:fs;
 *  - binaries are located up-front (`findBinary`) so commands fail with a
 *    clear, actionable error instead of an opaque ENOENT;
 *  - every invocation supports --dry-run (prints the exact argv, runs
 *    nothing) and a timeout that kills the child;
 *  - on failure the tail of stderr is preserved on the typed error.
 */
import { spawn, spawnSync } from 'node:child_process';

/** ffmpeg/ffprobe is not on PATH (or not executable). */
export class BinaryNotFoundError extends Error {
  override readonly name = 'BinaryNotFoundError';
  constructor(readonly binary: string) {
    super(
      `Required binary "${binary}" was not found on PATH. ` +
        `Install ffmpeg (https://ffmpeg.org/download.html) and ensure "${binary}" is executable, ` +
        `or re-run with --dry-run to inspect the commands without executing them.`,
    );
  }
}

/** ffmpeg/ffprobe ran but exited non-zero (or timed out). */
export class FFmpegError extends Error {
  override readonly name = 'FFmpegError';
  constructor(
    readonly binary: string,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderrTail: string,
    readonly timedOut: boolean,
  ) {
    super(
      timedOut
        ? `${binary} timed out after the configured limit: ${formatCommand(binary, args)}`
        : `${binary} exited with code ${exitCode ?? 'signal'}: ${formatCommand(binary, args)}\n` +
            `stderr (tail):\n${stderrTail}`,
    );
  }
}

/** The requested ffmpeg build lacks an encoder needed for the job. */
export class EncoderUnavailableError extends Error {
  override readonly name = 'EncoderUnavailableError';
}

export interface RunOptions {
  /** Print the command instead of executing it. */
  dryRun?: boolean;
  /** Kill the child after this many milliseconds (default 10 min). */
  timeoutMs?: number;
  /** Chars of stderr to retain on errors (default 4096). */
  stderrTailChars?: number;
}

export interface RunResult {
  /** True when the command was only printed (dry-run). */
  dryRun: boolean;
  /** Full captured stdout. */
  stdout: string;
  /** Tail of captured stderr (progress lines etc.). */
  stderrTail: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TAIL = 4096;

/** Render an argv as a copy-pasteable shell command line. */
export function formatCommand(binary: string, args: readonly string[]): string {
  const quote = (a: string) => (/[\s'"$\\]/.test(a) ? JSON.stringify(a) : a);
  return [binary, ...args].map(quote).join(' ');
}

/** Synchronously resolve a binary on PATH; null when absent. */
export function findBinary(name: string): string | null {
  const res = spawnSync(name, ['-version'], { stdio: 'ignore' });
  if (res.error || res.status === null || res.status === undefined) return null;
  // `-version` exits 0 for both ffmpeg and ffprobe.
  return res.status === 0 ? name : null;
}

/** Resolve a binary or throw a clear BinaryNotFoundError. */
export function requireBinary(name: string): string {
  const found = findBinary(name);
  if (found === null) throw new BinaryNotFoundError(name);
  return found;
}

/** List encoder names this ffmpeg build supports (empty when unknown). */
export function listEncoders(): string[] {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) return [];
  const out: string[] = [];
  for (const line of String(res.stdout).split('\n')) {
    const m = /^\s*[A-Z.]{6}\s+(\S+)/.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

function tailOf(text: string, max: number): string {
  return text.length <= max ? text : text.slice(text.length - max);
}

/**
 * Run a binary, streaming stdout/stderr to memory. In dry-run mode the exact
 * command is printed to stdout and nothing is executed.
 */
export function run(binary: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  if (opts.dryRun) {
    process.stdout.write(`${formatCommand(binary, args)}\n`);
    return Promise.resolve({ dryRun: true, stdout: '', stderrTail: '' });
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tailChars = opts.stderrTailChars ?? DEFAULT_TAIL;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      stdout += d;
    });
    child.stderr.on('data', (d: string) => {
      stderr = tailOf(stderr + d, tailChars * 2);
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') reject(new BinaryNotFoundError(binary));
      else reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stderrTail = tailOf(stderr, tailChars);
      if (timedOut || code !== 0) {
        reject(new FFmpegError(binary, args, code, stderrTail, timedOut));
      } else {
        resolve({ dryRun: false, stdout, stderrTail });
      }
    });
  });
}
