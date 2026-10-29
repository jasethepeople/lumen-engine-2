/**
 * CliExecutor tests — command construction and failure mapping with a mocked
 * spawn (no real ffmpeg / CLI process is ever started).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CliExecutor, FfmpegUnavailableError } from '../dist/index.js';

const CLI = '/repo/app/cli/dist/bin/lumen-media.js';

function makeExecutor(spawnImpl, opts = {}) {
  const calls = [];
  const exec = new CliExecutor({
    cliPath: CLI,
    nodePath: '/usr/bin/node',
    spawn: async (cmd, args) => {
      calls.push([cmd, ...args]);
      return spawnImpl(args);
    },
    ...opts,
  });
  return { exec, calls };
}

function job(ops = ['probe']) {
  return { id: 'hero', kind: 'video', sourceName: 'hero.mp4', bytes: new Uint8Array([9, 9]), ops };
}

const ctx = { workDir: '/tmp/lumen-test', signal: new AbortController().signal };

test('probe: builds node + cli + probe argv and parses JSON stdout', async () => {
  const { exec, calls } = makeExecutor(() => ({
    code: 0,
    stdout: JSON.stringify({ input: 'x', duration: 2, codec: 'h264', width: 640, height: 360, fps: 30 }),
    stderr: '',
  }));
  const res = await exec.execute(job(), 'probe', ctx);
  assert.equal(res.ok, true);
  assert.equal(res.outputs.probe.codec, 'h264');
  const [cmd, cli, sub, input] = calls[0];
  assert.equal(cmd, '/usr/bin/node');
  assert.equal(cli, CLI);
  assert.equal(sub, 'probe');
  assert.match(input, /hero\.mp4$/); // bytes materialized to a temp file
});

test('scrub-mp4: maps to `scrub <input> -o <workDir>`', async () => {
  const { exec, calls } = makeExecutor(() => ({ code: 0, stdout: '', stderr: '' }));
  const res = await exec.execute(job(), 'scrub-mp4', ctx);
  assert.equal(res.ok, true);
  const argv = calls[0].slice(2);
  assert.equal(argv[0], 'scrub');
  assert.deepEqual(argv.slice(2), ['-o', '/tmp/lumen-test']);
  assert.match(res.outputs.scrub, /hero-scrub\.mp4$/);
});

test('frame-stack: one frames invocation per fps tier, webp format', async () => {
  const { exec, calls } = makeExecutor(() => ({ code: 0, stdout: '', stderr: '' }));
  const res = await exec.execute(job(), 'frame-stack', ctx);
  assert.equal(calls.length, 2); // default tiers [15, 30]
  for (const [i, fps] of [15, 30].entries()) {
    const argv = calls[i].slice(2);
    assert.equal(argv[0], 'frames');
    assert.deepEqual(argv.slice(2), [
      '-o', `/tmp/lumen-test/frames-${fps}fps`, '--format', 'webp', '--fps', String(fps),
    ]);
  }
  assert.deepEqual(res.outputs.stacks.map((s) => s.fps), [15, 30]);
});

test('manifest: scrubs + highest-fps stack wired into the manifest command', async () => {
  const { exec, calls } = makeExecutor(() => ({ code: 0, stdout: '{"version":1}', stderr: '' }));
  const res = await exec.execute(job(), 'manifest', ctx);
  const argv = calls[0].slice(2);
  assert.equal(argv[0], 'manifest');
  assert.equal(argv[1], 'hero');
  const scrubIdx = argv.indexOf('--scrub');
  const framesIdx = argv.indexOf('--frames');
  assert.match(argv[scrubIdx + 1], /hero-scrub\.mp4$/);
  assert.match(argv[framesIdx + 1], /frames-30fps$/);
  assert.deepEqual(res.outputs.manifest, { version: 1 });
});

test('binary-not-found stderr → typed FfmpegUnavailableError', async () => {
  const { exec } = makeExecutor(() => ({
    code: 1,
    stdout: '',
    stderr: 'lumen-media: error: Required binary "ffmpeg" was not found on PATH.',
  }));
  await assert.rejects(exec.execute(job(), 'scrub-mp4', ctx), (err) => {
    assert.ok(err instanceof FfmpegUnavailableError);
    assert.equal(err.binary, 'ffmpeg');
    return true;
  });
});

test('any probe failure degrades to FfmpegUnavailableError (availability check)', async () => {
  const { exec } = makeExecutor(() => ({ code: 1, stdout: '', stderr: 'ffprobe exploded' }));
  await assert.rejects(exec.execute(job(), 'probe', ctx), FfmpegUnavailableError);
});

test('non-availability CLI failure surfaces as a plain error with exit code', async () => {
  const { exec } = makeExecutor(() => ({ code: 2, stdout: '', stderr: 'lumen-media: error: bad flag' }));
  await assert.rejects(exec.execute(job(), 'scrub-mp4', ctx), /exited 2/);
});

test('custom fps tiers propagate to frames commands', async () => {
  const { exec, calls } = makeExecutor(() => ({ code: 0, stdout: '', stderr: '' }), {
    frameFps: [12, 24],
  });
  await exec.execute(job(), 'frame-stack', ctx);
  assert.equal(calls.length, 2);
  assert.match(calls[0].join(' '), /--fps 12/);
  assert.match(calls[1].join(' '), /--fps 24/);
});

test('CliExecutor failure feeds the queue as a failed job with reason', async () => {
  const { AssetUploadQueue } = await import('../dist/index.js');
  const { exec } = makeExecutor(() => ({
    code: 1,
    stdout: '',
    stderr: 'Required binary "ffmpeg" was not found on PATH.',
  }));
  const q = new AssetUploadQueue({ executor: exec, workDir: '/tmp/lumen-test' });
  q.enqueue({ ...job(['scrub-mp4', 'manifest']), id: 'q1' });
  q.enqueue({ ...job(['probe']), id: 'q2' });
  await q.idle();
  const jobs = Object.fromEntries(q.listJobs().map((j) => [j.id, j]));
  assert.equal(jobs.q1.state, 'failed');
  assert.equal(jobs.q1.failureReason, 'FfmpegUnavailableError');
});
