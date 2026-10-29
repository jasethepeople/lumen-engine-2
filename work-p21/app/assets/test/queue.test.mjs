/**
 * AssetUploadQueue tests — lifecycle with a mock executor (no ffmpeg).
 *
 * Covers: enqueue/run ordering, progress callbacks, per-op results,
 * failure isolation (a failing job does not stall later jobs),
 * FfmpegUnavailableError reason propagation, cancel (pending + running),
 * retry, pluggable concurrency, and duplicate-id guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetUploadQueue, FfmpegUnavailableError } from '../dist/index.js';

function job(id, ops = ['probe', 'scrub-mp4']) {
  return { id, kind: 'video', sourceName: `${id}.mp4`, bytes: new Uint8Array([1, 2, 3]), ops };
}

/** Executor whose per-job/op behavior is driven by a handler map. */
function mockExecutor(handler = () => ({ ok: true })) {
  const calls = [];
  return {
    calls,
    async execute(j, op) {
      calls.push(`${j.id}:${op}`);
      const r = await handler(j, op);
      if (r instanceof Error) throw r;
      return { op, ...r };
    },
  };
}

test('sequential lifecycle: pending → running → done with per-op progress', async () => {
  const exec = mockExecutor();
  const q = new AssetUploadQueue({ executor: exec });
  const events = [];
  q.onProgress((p) => events.push(p));
  q.enqueue(job('a', ['probe', 'scrub-mp4', 'manifest']));
  await q.idle();
  assert.deepEqual(exec.calls, ['a:probe', 'a:scrub-mp4', 'a:manifest']);
  const [rec] = q.listJobs();
  assert.equal(rec.state, 'done');
  assert.equal(rec.results.length, 3);
  assert.ok(rec.startedAt <= rec.finishedAt);
  // 3 op events + 1 done event
  assert.equal(events.length, 4);
  assert.equal(events.at(-1).state, 'done');
  assert.deepEqual(events.slice(0, 3).map((e) => e.op), ['probe', 'scrub-mp4', 'manifest']);
});

test('failure isolation: a failing job does not stall the queue', async () => {
  const exec = mockExecutor((j, op) =>
    j.id === 'bad' && op === 'scrub-mp4' ? { ok: false, error: 'boom' } : { ok: true },
  );
  const q = new AssetUploadQueue({ executor: exec });
  q.enqueue(job('bad'));
  q.enqueue(job('good'));
  await q.idle();
  const jobs = Object.fromEntries(q.listJobs().map((j) => [j.id, j]));
  assert.equal(jobs.bad.state, 'failed');
  assert.equal(jobs.bad.error, 'boom');
  assert.equal(jobs.good.state, 'done');
  assert.deepEqual(exec.calls, ['bad:probe', 'bad:scrub-mp4', 'good:probe', 'good:scrub-mp4']);
});

test('FfmpegUnavailableError: job failed with typed reason, queue continues', async () => {
  const exec = mockExecutor((j) => {
    if (j.id === 'vid') return new FfmpegUnavailableError('ffmpeg');
    return { ok: true };
  });
  const q = new AssetUploadQueue({ executor: exec });
  q.enqueue(job('vid', ['scrub-mp4']));
  q.enqueue(job('img', ['probe']));
  await q.idle();
  const jobs = Object.fromEntries(q.listJobs().map((j) => [j.id, j]));
  assert.equal(jobs.vid.state, 'failed');
  assert.equal(jobs.vid.failureReason, 'FfmpegUnavailableError');
  assert.match(jobs.vid.error, /ffmpeg/);
  assert.equal(jobs.img.state, 'done');
});

test('cancel: pending job transitions to canceled and never runs', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const exec = mockExecutor(async (j) => {
    if (j.id === 'first') await gate;
    return { op: 'probe', ok: true };
  });
  const q = new AssetUploadQueue({ executor: exec });
  q.enqueue(job('first', ['probe']));
  q.enqueue(job('second', ['probe']));
  assert.equal(q.cancel('second'), true);
  release();
  await q.idle();
  const jobs = Object.fromEntries(q.listJobs().map((j) => [j.id, j]));
  assert.equal(jobs.second.state, 'canceled');
  assert.equal(jobs.first.state, 'done');
});

test('cancel: running job aborts cooperatively after current op', async () => {
  const exec = mockExecutor(async (j, op) => {
    if (op === 'probe') q.cancel('run');
    return { op, ok: true };
  });
  const q = new AssetUploadQueue({ executor: exec });
  q.enqueue(job('run', ['probe', 'scrub-mp4', 'manifest']));
  await q.idle();
  const [rec] = q.listJobs();
  assert.equal(rec.state, 'canceled');
  assert.equal(rec.results.length, 1); // only the in-flight op completed
});

test('retry: failed job re-runs from op 0', async () => {
  let fail = true;
  const exec = mockExecutor((j, op) => (fail && op === 'probe' ? { ok: false, error: 'x' } : { ok: true }));
  const q = new AssetUploadQueue({ executor: exec });
  q.enqueue(job('r', ['probe', 'scrub-mp4']));
  await q.idle();
  assert.equal(q.getJob('r').state, 'failed');
  fail = false;
  assert.equal(q.retry('r'), true);
  await q.idle();
  assert.equal(q.getJob('r').state, 'done');
  assert.equal(q.retry('r'), false); // done jobs cannot be retried
  assert.equal(q.cancel('nope'), false);
});

test('concurrency=2 runs two jobs without interleaving a single job ops order', async () => {
  const exec = mockExecutor(async (j, op) => {
    await new Promise((r) => setTimeout(r, 5));
    return { op, ok: true };
  });
  const q = new AssetUploadQueue({ executor: exec, concurrency: 2 });
  q.enqueue(job('x', ['probe', 'scrub-mp4']));
  q.enqueue(job('y', ['probe', 'scrub-mp4']));
  await q.idle();
  assert.deepEqual(q.listJobs().map((j) => j.state), ['done', 'done']);
  // Per-job op order is preserved even with parallel workers.
  for (const id of ['x', 'y']) {
    const ops = exec.calls.filter((c) => c.startsWith(`${id}:`));
    assert.deepEqual(ops, [`${id}:probe`, `${id}:scrub-mp4`]);
  }
});

test('guards: duplicate pending id rejected; unknown op rejected', async () => {
  const exec = mockExecutor(async (j) => {
    await new Promise((r) => setTimeout(r, 10));
    return { op: 'probe', ok: true };
  });
  const q = new AssetUploadQueue({ executor: exec });
  q.enqueue(job('dup', ['probe']));
  assert.throws(() => q.enqueue(job('dup', ['probe'])), /already queued/);
  assert.throws(() => q.enqueue(job('bad-op', ['transcode'])), /unknown asset op/);
  await q.idle();
});

test('unsubscribed progress callbacks stop firing; throwing callbacks are safe', async () => {
  const exec = mockExecutor();
  const q = new AssetUploadQueue({ executor: exec });
  let count = 0;
  const off = q.onProgress(() => count++);
  q.onProgress(() => {
    throw new Error('observer bug');
  });
  q.enqueue(job('cb', ['probe']));
  await q.idle();
  off();
  q.enqueue(job('cb2', ['probe']));
  await q.idle();
  assert.equal(count, 2); // op event + done event for the first job only
  assert.deepEqual(q.listJobs().map((j) => j.state), ['done', 'done']);
});
