#!/usr/bin/env node
/**
 * examples/cinematic-story — run the full Lumen pipeline for engine.config.json:
 *
 *   parseConfig → template registry lookup → compose → codegen (static)
 *   → build pipeline (validate/optimize/hash/emit/report) → dist/
 *
 * Run from the repository root after `bash scripts/build-all.sh`:
 *   node examples/cinematic-story/build-example.mjs
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseConfig } from '@lumen/config';
import { createExtendedRegistry } from '@lumen/templates';
import { generate } from '@lumen/codegen';
import { build } from '@lumen/build';
import { manifestFromAssetRefs } from '@lumen/runtime';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'dist');

// 1. Parse + validate config (migrations + defaults applied).
const raw = readFileSync(join(here, 'engine.config.json'), 'utf8');
const parsed = parseConfig(raw);
if (!parsed.ok) {
  for (const e of parsed.errors) console.error(`config error: ${e.path}: ${e.message}`);
  process.exit(1);
}
const config = parsed.config;
console.log(`config ok (migrations applied: ${parsed.appliedMigrations.length})`);

// 2. Template lookup + composition.
const registry = createExtendedRegistry();
const { warnings } = registry.validate(config);
for (const w of warnings) console.warn(`template warning: ${w.message ?? w}`);
const descriptor = registry.require(config.template);
const manifest = manifestFromAssetRefs(config.assets);
const composedScene = descriptor.compose(config, manifest);
console.log(
  `composed: ${composedScene.sceneGraph.length} root nodes, ${composedScene.tracks.length} tracks, ${composedScene.bindings.length} bindings`,
);

// 3. Codegen + build pipeline.
mkdirSync(outDir, { recursive: true });
const artifact = await build(
  {
    target: { ...config.build, target: 'static' },
    outDir,
    onReport: (text) => console.log(text),
  },
  (options) => generate(config, descriptor, composedScene, options),
);

console.log(`entry: ${artifact.entry}`);
console.log(`files: ${artifact.files.map((f) => f.path).join(', ')}`);
console.log(`budgets passed: ${artifact.budgets.passed}`);
console.log(`dist written to ${outDir}`);
