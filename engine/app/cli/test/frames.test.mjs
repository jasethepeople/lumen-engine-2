/**
 * Frame-stack scanning tests on synthetic directories, encoder resolution
 * logic, and (when ffmpeg is present) a real extraction smoke test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  countFrames,
  extractFrames,
  listFrameFiles,
  resolveFrameEncoder,
} from '../dist/frames.js';
import { EncoderUnavailableError, findBinary } from '../dist/ffmpeg.js';

test('countFrames counts only frame-NNNNN.<fmt> files, sorted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-frames-'));
  try {
    for (const n of ['00003', '00001', '00002', '00010']) {
      writeFileSync(join(dir, `frame-${n}.webp`), 'x');
    }
    writeFileSync(join(dir, 'frame-1.webp'), 'bad padding');
    writeFileSync(join(dir, 'frame-00001.avif'), 'wrong format');
    writeFileSync(join(dir, 'other.webp'), 'wrong name');
    assert.equal(countFrames(dir, 'webp'), 4);
    assert.deepEqual(listFrameFiles(dir, 'webp'), [
      'frame-00001.webp', 'frame-00002.webp', 'frame-00003.webp', 'frame-00010.webp',
    ]);
    assert.equal(countFrames(dir, 'avif'), 1);
    assert.equal(countFrames(join(dir, 'missing'), 'webp'), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveFrameEncoder: webp prefers libwebp, falls back to native', () => {
  assert.equal(resolveFrameEncoder('webp', ['libwebp', 'webp']), 'libwebp');
  assert.equal(resolveFrameEncoder('webp', ['webp']), 'webp');
  assert.throws(() => resolveFrameEncoder('webp', ['libx264']), EncoderUnavailableError);
});

test('resolveFrameEncoder: avif needs an AV1 encoder, error explains rebuild', () => {
  assert.equal(resolveFrameEncoder('avif', ['libaom-av1']), 'libaom-av1');
  assert.equal(resolveFrameEncoder('avif', ['librav1e']), 'librav1e');
  assert.throws(
    () => resolveFrameEncoder('avif', ['libwebp']),
    /no AV1 encoder.*--enable-libaom|--format webp/s,
  );
});

const hasFfmpeg = findBinary('ffmpeg') !== null;

test('extractFrames real run (skipped when ffmpeg absent)', { skip: !hasFfmpeg && 'ffmpeg not on PATH' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-extract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = join(dir, 'src.mp4');
  const { execFileSync } = await import('node:child_process');
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=30',
    '-pix_fmt', 'yuv420p', src,
  ]);
  const outDir = join(dir, 'frames');
  const res = await extractFrames(src, outDir, { fps: 10, format: 'webp' });
  assert.equal(res.frameCount, 10);
  assert.equal(countFrames(outDir, 'webp'), 10);
  assert.match(res.pattern, /frame-%05d\.webp$/);
});

if (!hasFfmpeg) {
  test('ffmpeg absent: binary detection reports null and tests degrade', () => {
    assert.equal(findBinary('ffmpeg'), null);
  });
}
