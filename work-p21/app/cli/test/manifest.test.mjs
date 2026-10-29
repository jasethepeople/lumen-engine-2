/**
 * Manifest emission tests: the generated <name>.asset.json must satisfy the
 * real IRAssetRef/IRAssetVariant contract shape, and the printed manifest
 * snippet must pass the real @lumen/assets normalizeManifest validator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  assertIRAssetRef,
  assertVideoAssetEntry,
  buildAssetRef,
  buildManifestSnippet,
  writeAssetFile,
} from '../dist/manifest.js';
import { normalizeManifest } from '../../../packages/assets/dist/manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '..', 'dist', 'bin', 'lumen-media.js');

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-cli-test-'));
  const frames = join(dir, 'frames');
  mkdirSync(frames);
  for (let i = 1; i <= 7; i++) {
    writeFileSync(join(frames, `frame-${String(i).padStart(5, '0')}.webp`), `f${i}`);
  }
  writeFileSync(join(frames, 'notes.txt'), 'not a frame');
  const scrub = join(dir, 'hero-scrub.mp4');
  writeFileSync(scrub, Buffer.alloc(1234));
  return { dir, frames, scrub };
}

test('buildAssetRef emits an IRAssetRef-shaped object with exact variant fields', async (t) => {
  const { dir, frames, scrub } = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ref = await buildAssetRef({
    name: 'hero', scrub, frames, framesFormat: 'webp', framesFps: 30, hls: 'stream.m3u8', duration: 4.5,
  });
  // Runtime structural assert against the contracts shape.
  assertIRAssetRef(ref);
  assert.equal(ref.id, 'hero');
  assert.equal(ref.kind, 'video');
  assert.equal(ref.src, scrub);
  assert.equal(ref.duration, 4.5);
  assert.equal(ref.variants.length, 3);

  const [gop1, stack, hls] = ref.variants;
  // gop1 scrub variant: only contracts IRAssetVariant fields (+ mime hint).
  assert.equal(gop1.delivery, 'gop1');
  assert.equal(gop1.format, 'mp4');
  assert.equal(gop1.codec, 'h264');
  assert.equal(gop1.bytes, 1234);
  for (const k of Object.keys(gop1)) {
    assert.ok(['src', 'format', 'codec', 'width', 'bytes', 'delivery', 'mime'].includes(k), `unexpected field ${k}`);
  }
  // frame-stack variant: fps/frameCount/pattern recorded from real files.
  assert.equal(stack.delivery, 'frame-stack');
  assert.equal(stack.fps, 30);
  assert.equal(stack.frameCount, 7);
  assert.match(stack.pattern, /frame-%05d\.webp$/);
  assert.equal(stack.src, stack.pattern);
  // hls variant.
  assert.equal(hls.delivery, 'hls');
  assert.equal(hls.format, 'hls');
});

test('manifest snippet passes the real @lumen/assets normalizeManifest validator', async (t) => {
  const { dir, frames, scrub } = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const inputs = { name: 'hero', scrub, frames, hls: 'stream.m3u8', duration: 4.5 };
  const ref = await buildAssetRef(inputs);
  const snippet = await buildManifestSnippet(inputs, ref);
  // The authoritative validator from packages/assets/src/manifest.ts.
  const normalized = normalizeManifest(JSON.parse(JSON.stringify(snippet)));
  const entry = normalized.assets['hero'];
  assert.equal(entry.kind, 'video');
  assert.equal(entry.scrubOptimized, true);
  assert.equal(entry.duration, 4.5);
  assert.equal(entry.variants.mp4.codec, 'h264');
  assert.equal(entry.variants.hls.playlist, 'stream.m3u8');
  assert.equal(entry.preload, 'lazy');
  assert.equal(entry.poster, join(frames, 'frame-00001.webp'));
  assertVideoAssetEntry('hero', entry);
});

test('bin manifest writes <name>.asset.json and prints a valid snippet', async (t) => {
  const { dir, frames, scrub } = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stdout = execFileSync(
    process.execPath,
    [BIN, 'manifest', 'hero', '--scrub', scrub, '--frames', frames, '--duration', '2', '-o', dir],
    { encoding: 'utf8' },
  );
  const ref = JSON.parse(readFileSync(join(dir, 'hero.asset.json'), 'utf8'));
  assertIRAssetRef(ref);
  const snippet = JSON.parse(stdout);
  const normalized = normalizeManifest(snippet);
  assert.equal(normalized.assets['hero'].id, 'hero');
});

test('bin manifest requires at least one variant source', () => {
  assert.throws(
    () => execFileSync(process.execPath, [BIN, 'manifest', 'hero'], { stdio: 'pipe' }),
    /at least one of --scrub, --frames, --hls/,
  );
});

test('writeAssetFile round-trips parseable JSON', async (t) => {
  const { dir, scrub } = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ref = await buildAssetRef({ name: 'a', scrub, duration: 1 });
  const file = writeAssetFile({ name: 'a', outDir: dir, scrub }, ref);
  assert.equal(file, join(dir, 'a.asset.json'));
  assertIRAssetRef(JSON.parse(readFileSync(file, 'utf8')));
});
