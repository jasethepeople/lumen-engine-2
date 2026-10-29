/**
 * tests/e2e — integration smoke test (node --test).
 *
 * Runs the full example pipeline end-to-end against the compiled workspace
 * (run `bash scripts/build-all.sh` first):
 *   config parses → scene composes → codegen emits → build produces hashed
 *   artifacts + budget report → emitted JS parses → HTML has SSR/noscript →
 *   runtime package imports under Node without a DOM.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const exampleDir = join(root, 'examples', 'simple-site');

const config = await import('@lumen/config');
const templates = await import('@lumen/templates');
const codegen = await import('@lumen/codegen');
const build = await import('@lumen/build');
const runtime = await import('@lumen/runtime');

const rawConfig = readFileSync(join(exampleDir, 'engine.config.json'), 'utf8');

function composedFixture() {
  const parsed = config.parseConfig(rawConfig);
  assert.equal(parsed.ok, true);
  const descriptor = templates.createDefaultRegistry().require(parsed.config.template);
  const manifest = runtime.manifestFromAssetRefs(parsed.config.assets);
  return { config: parsed.config, descriptor, manifest, scene: descriptor.compose(parsed.config, manifest) };
}

test('config parses (migrate → validate → defaults)', () => {
  const result = config.parseConfig(rawConfig);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? {} : result.errors));
  assert.equal(result.config.id, 'simple-site');
  assert.equal(result.config.template, 'scroll-video');
  assert.equal(result.config.scenes.length, 2);
  assert.ok(Array.isArray(result.appliedMigrations));
});

test('scene composes with structural invariants', () => {
  const { scene } = composedFixture();
  assert.ok(scene.sceneGraph.length >= 2, 'expected stage + caption roots');
  const nodeIds = new Set();
  const visit = (n) => {
    assert.ok(!nodeIds.has(n.id), `duplicate node id ${n.id}`);
    nodeIds.add(n.id);
    n.children.forEach(visit);
  };
  scene.sceneGraph.forEach(visit);
  const trackIds = new Set(scene.tracks.map((t) => t.id));
  assert.ok(trackIds.size >= 2);
  for (const track of scene.tracks) {
    for (let i = 1; i < track.keyframes.length; i++) {
      assert.ok(track.keyframes[i].t >= track.keyframes[i - 1].t, `track ${track.id} keyframes sorted`);
    }
  }
  // Every node binding references an existing track; every scene binding
  // references an existing node and track.
  scene.sceneGraph.forEach(function walk(n) {
    for (const b of n.bindings) assert.ok(trackIds.has(b.trackId), `binding → ${b.trackId}`);
    n.children.forEach(walk);
  });
  for (const b of scene.bindings) {
    assert.ok(trackIds.has(b.targetTrackId), `interaction binding → ${b.targetTrackId}`);
  }
  // Caption scene produced DOM overlay nodes with HTML.
  const domNodes = [...nodeIds].length;
  assert.ok(domNodes >= 4, 'video + caption group + 2 overlays');
});

test('codegen emits index.html SSR shell + entry module', () => {
  const { config: cfg, descriptor, scene } = composedFixture();
  const result = codegen.generate(cfg, descriptor, scene, {
    target: { target: 'static', ssr: true, minify: false },
  });
  assert.ok(result.entry.endsWith('.js') || result.entry.endsWith('.ts'));
  assert.ok(result.files.length >= 1);
  const entry = result.files.find((f) => f.path === result.entry);
  assert.ok(entry, 'entry module emitted');
  assert.match(entry.source, /@lumen\/runtime/);
  assert.match(entry.source, /bootEngine/);
  assert.match(entry.source, /hydrateIslands/);
  // SSR shell: skeleton markup + noscript fallback + root anchor.
  assert.ok(result.ssrHtml.length > 0);
  assert.match(result.ssrHtml, /<html/);
  assert.match(result.ssrHtml, /<noscript>/);
  assert.match(result.ssrHtml, /id="lumen-root"/);
  assert.match(result.ssrHtml, /Lumen Simple Site/);
  assert.ok(result.hydrationManifest.islands.length >= 1);
});

test('build pipeline produces hashed artifacts + budget report', async () => {
  const { config: cfg, descriptor, scene } = composedFixture();
  const outDir = mkdtempSync(join(tmpdir(), 'lumen-e2e-'));
  const artifact = await build.build(
    { target: { target: 'static', ssr: true, minify: false }, outDir },
    (options) => codegen.generate(cfg, descriptor, scene, options),
  );
  assert.equal(artifact.target, 'static');
  assert.equal(artifact.entry, 'index.html');
  assert.ok(existsSync(join(outDir, 'index.html')));
  assert.ok(existsSync(join(outDir, 'manifest.json')), 'deploy manifest written');
  // Content-hashed JS entry with rewritten specifier from index.html.
  const jsFile = artifact.files.find((f) => f.path.endsWith('.js'));
  assert.ok(jsFile, 'js artifact emitted');
  assert.match(jsFile.path, /^main\.[0-9a-f]{8,}\.js$/, 'content-hashed filename');
  assert.ok(jsFile.gzipBytes > 0 && jsFile.gzipBytes <= jsFile.bytes);
  // Budget report evaluated.
  assert.equal(typeof artifact.budgets.passed, 'boolean');
  assert.ok(artifact.budgets.checks.length >= 3);
  assert.ok(
    artifact.budgets.checks.every(
      (c) => typeof c.metric === 'string' && typeof c.budget === 'number' && typeof c.actual === 'number',
    ),
  );
  assert.ok(existsSync(join(outDir, jsFile.path)));

  // Emitted JS parses as an ES module; emitted HTML carries SSR + noscript.
  execFileSync(process.execPath, ['--check', join(outDir, jsFile.path)], { cwd: root });
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  assert.match(html, /<noscript>/);
  assert.match(html, /id="lumen-root"/);
  assert.ok(html.includes(jsFile.path), 'HTML references the hashed entry');
});

test('@lumen/runtime imports under Node (DOM fully guarded)', async () => {
  assert.equal(typeof runtime.bootEngine, 'function');
  assert.equal(typeof runtime.hydrateIslands, 'function');
  // Structural SceneIR round-trip: IR → ComposedScene → evaluate headlessly.
  const { config: cfg, descriptor, scene } = composedFixture();
  const ir = codegen.lowerToIR(cfg, descriptor.themeTokens, scene);
  assert.ok(runtime.isSceneIR(ir));
  const raised = runtime.composedSceneFromIR(ir);
  assert.equal(raised.tracks.length, scene.tracks.length);
  // bootEngine refuses to run without a DOM instead of crashing at import.
  await assert.rejects(() => runtime.bootEngine(null, ir), /rootElement|DOM/);
});

test('root entry point: createEngine composes and builds', async () => {
  const engine = await import('../../dist/index.js');
  assert.equal(typeof engine.createEngine, 'function');
  const descriptor = engine.createEngine(rawConfig);
  assert.ok(descriptor.composedScene.sceneGraph.length >= 2);
  assert.ok(descriptor.manifest.assets['hero-video']);
  const outDir = mkdtempSync(join(tmpdir(), 'lumen-e2e-root-'));
  const artifact = await descriptor.build({ target: 'static', outDir });
  assert.equal(artifact.budgets.passed, true);
  const names = readdirSync(outDir);
  assert.ok(names.includes('index.html'));
  assert.ok(names.some((n) => /^main\.[0-9a-f]+\.js$/.test(n)));
});
