/**
 * tests/e2e — QA regression (FB1): generated static sites run unbundled and
 * scrub is wired end-to-end.
 *
 *   1. index.html contains an import map whose every @lumen/* entry resolves
 *      to a vendored file on disk; all emitted/vendored JS passes node --check;
 *      every bare @lumen import in vendored files is covered by the map.
 *   2. The emitted scrub track has nonzero keyframes end-to-end (config
 *      duration flows through IR → manifest → composed track).
 *
 * Run `bash scripts/build-all.sh` first. Uses the scroll-cinema-landing
 * example config.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const exampleDir = join(root, 'examples', 'scroll-cinema-landing');

const config = await import('@lumen/config');
const templates = await import('@lumen/templates');
const codegen = await import('@lumen/codegen');
const build = await import('@lumen/build');
const runtime = await import('@lumen/runtime');

function* walkJs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJs(abs);
    else if (entry.name.endsWith('.js')) yield abs;
  }
}

function buildStaticSite() {
  const raw = readFileSync(join(exampleDir, 'engine.config.json'), 'utf8');
  const parsed = config.parseConfig(raw);
  assert.equal(parsed.ok, true);
  const descriptor = templates.createExtendedRegistry().require(parsed.config.template);
  const manifest = runtime.manifestFromAssetRefs(parsed.config.assets);
  const composed = descriptor.compose(parsed.config, manifest);
  const outDir = mkdtempSync(join(tmpdir(), 'lumen-e2e-qa-'));
  return { parsed, descriptor, composed, outDir };
}

test('static site: import map resolves to vendored files; all JS parses', async () => {
  const { parsed, descriptor, composed, outDir } = buildStaticSite();
  try {
    const artifact = await build.build(
      { target: { ...parsed.config.build, target: 'static' }, outDir },
      (options) => codegen.generate(parsed.config, descriptor, composed, options),
    );

    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    const mapMatch = html.match(/<script type="importmap">([^<]+)<\/script>/);
    assert.ok(mapMatch, 'index.html carries an import map');
    const { imports } = JSON.parse(mapMatch[1]);
    assert.ok(imports['@lumen/runtime'], 'import map covers @lumen/runtime');

    // Every import-map entry resolves to a file on disk.
    for (const [spec, rel] of Object.entries(imports)) {
      assert.ok(spec.startsWith('@lumen/'), `unexpected specifier ${spec}`);
      statSync(join(outDir, rel));
    }

    // The emitted entry references the bare specifier the map resolves.
    const entrySrc = readFileSync(join(outDir, artifact.entry), 'utf8');
    assert.ok(entrySrc.includes('@lumen/runtime'), 'entry imports the bare runtime specifier');

    // All emitted + vendored JS parses as ES modules.
    for (const file of walkJs(outDir)) {
      execFileSync(process.execPath, ['--check', file]);
    }

    // Every bare @lumen import in vendored files is covered by the map.
    const covered = new Set(Object.keys(imports));
    for (const file of walkJs(join(outDir, 'vendor'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/from\s+['"](@lumen\/[a-z]+)['"]/g)) {
        assert.ok(covered.has(m[1]), `${file}: uncovered bare import ${m[1]}`);
      }
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('scroll scrub: nonzero keyframes flow end-to-end into the emitted bundle', async () => {
  const { parsed, descriptor, composed, outDir } = buildStaticSite();
  try {
    // Config declares duration: 12 — the manifest entry carries it.
    const manifest = runtime.manifestFromAssetRefs(parsed.config.assets);
    assert.equal(manifest.assets['cinema-video'].duration, 12);

    // The composed scrub track animates playback.time 0 → 12.
    const scrub = composed.tracks.find((t) => t.id.includes('scrub'));
    assert.ok(scrub, 'scrub track composed');
    const last = scrub.keyframes.at(-1);
    assert.ok(last.value > 0, `scrub keyframe end is nonzero (got ${last.value})`);

    const artifact = await build.build(
      { target: { ...parsed.config.build, target: 'static' }, outDir },
      (options) => codegen.generate(parsed.config, descriptor, composed, options),
    );
    const entrySrc = readFileSync(join(outDir, artifact.entry), 'utf8');
    const embedded = JSON.stringify(composed.tracks.find((t) => t.id === scrub.id));
    assert.ok(
      entrySrc.includes(`"value":${last.value}`) || entrySrc.includes(embedded.slice(0, 40)),
      'nonzero scrub keyframes present in emitted JS',
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
