/**
 * Command-construction tests: unit-test the argv builders and verify the
 * bin's --dry-run output for scrub / frames / probe matches exactly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildScrubArgs, scrubOutputName } from '../dist/scrub.js';
import { buildFramesArgs, framePattern } from '../dist/frames.js';
import { buildProbeArgs, parseFrameRate } from '../dist/probe.js';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '..', 'dist', 'bin', 'lumen-media.js');

function dryRun(args) {
  return execFileSync(process.execPath, [BIN, ...args, '--dry-run'], { encoding: 'utf8' });
}

test('scrub argv: GOP=1, no B-frames, faststart, width/crf defaults', () => {
  const args = buildScrubArgs('in.mp4', 'out/in-scrub.mp4');
  const s = args.join(' ');
  assert.match(s, /-g 1/);
  assert.match(s, /-bf 0/);
  assert.match(s, /-movflags \+faststart/);
  assert.match(s, /-c:v libx264/);
  assert.match(s, /-crf 23/);
  assert.match(s, /min\(1920,iw\)/);
  assert.match(s, /-an/);
});

test('scrub argv: --width and --crf honored', () => {
  const args = buildScrubArgs('in.mp4', 'o.mp4', { width: 1280, crf: 18 });
  const s = args.join(' ');
  assert.match(s, /min\(1280,iw\)/);
  assert.match(s, /-crf 18/);
});

test('scrubOutputName derives <stem>-scrub.mp4', () => {
  assert.equal(scrubOutputName('/a/b/hero.MP4'), 'hero-scrub.mp4');
});

test('frames argv: fps filter, pattern, encoder, avif still-picture', () => {
  const webp = buildFramesArgs('in.mp4', 'out/f', 'webp', 30, 'libwebp').join(' ');
  assert.match(webp, /-vf fps=30/);
  assert.match(webp, /-c:v libwebp/);
  assert.match(webp, /out\/f\/frame-%05d\.webp$/);
  const avif = buildFramesArgs('in.mp4', 'out/f', 'avif', 24, 'libaom-av1').join(' ');
  assert.match(avif, /-vf fps=24/);
  assert.match(avif, /-still-picture 1/);
  assert.match(avif, /frame-%05d\.avif$/);
  assert.equal(framePattern('webp'), 'frame-%05d.webp');
});

test('probe argv and frame-rate parsing', () => {
  assert.deepEqual(buildProbeArgs('x.mp4'), [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', 'x.mp4',
  ]);
  assert.ok(Math.abs(parseFrameRate('30000/1001') - 29.97) < 0.01);
  assert.equal(parseFrameRate('25/1'), 25);
  assert.equal(parseFrameRate('0/0'), 0);
  assert.equal(parseFrameRate(undefined), 0);
});

test('bin dry-run: scrub prints the exact ffmpeg command', () => {
  const out = dryRun(['scrub', 'in.mp4', '-o', 'out']);
  assert.match(out, /^ffmpeg -y -i in\.mp4 /);
  assert.match(out, /-g 1 -bf 0/);
  assert.match(out, /-movflags \+faststart out\/in-scrub\.mp4/);
});

test('bin dry-run: scrub honors --width/--crf', () => {
  const out = dryRun(['scrub', 'in.mp4', '-o', 'out', '--width', '960', '--crf', '20']);
  assert.match(out, /min\(960,iw\)/);
  assert.match(out, /-crf 20/);
});

test('bin dry-run: frames prints the exact ffmpeg command (webp + avif)', () => {
  const webp = dryRun(['frames', 'in.mp4', '-o', 'out/f', '--fps', '15']);
  assert.match(webp, /-vf fps=15/);
  assert.match(webp, /out\/f\/frame-%05d\.webp/);
  const avif = dryRun(['frames', 'in.mp4', '-o', 'out/f', '--format', 'avif']);
  assert.match(avif, /libaom-av1/);
  assert.match(avif, /frame-%05d\.avif/);
});

test('bin dry-run: probe prints the exact ffprobe command', () => {
  const out = dryRun(['probe', 'in.mp4']);
  assert.match(out, /^ffprobe -v error -print_format json -show_format -show_streams in\.mp4/);
});

test('bin rejects bad options with a clear error', () => {
  assert.throws(
    () => execFileSync(process.execPath, [BIN, 'frames', 'in.mp4', '-o', 'x', '--format', 'png'], { stdio: 'pipe' }),
    /--format must be webp or avif/,
  );
  assert.throws(
    () => execFileSync(process.execPath, [BIN, 'scrub', 'in.mp4'], { stdio: 'pipe' }),
    /missing required -o/,
  );
});
