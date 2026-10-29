import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string, rel: string) =>
  path.resolve(here, '../../', rel);

// @lumen/* packages are consumed from their BUILT dists — run
// `bash scripts/build-all.sh` from the repo root before dev/build.
const appRuntimeDist = pkg('app-runtime', 'app/runtime/dist/index.js');
// Agent A ships @lumen/app-runtime in app/runtime. When its dist is present
// we alias to it; otherwise we fall back to a local implementation of the
// same contract (src/lumen/app-runtime-fallback.ts) so the builder stays
// buildable on branches where app/runtime has not landed yet.
const appRuntimeEntry = fs.existsSync(appRuntimeDist)
  ? appRuntimeDist
  : path.resolve(here, 'src/lumen/app-runtime-fallback.ts');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Exact-match stubs first (object-form aliases do prefix replacement,
      // which breaks 'node:fs/promises' when 'node:fs' is aliased).
      ...[
        'node:child_process',
        'node:fs',
        'node:fs/promises',
        'node:os',
        'node:url',
        'node:module',
      ].map((spec) => ({
        find: new RegExp(`^${spec.replace(/[/$]/g, '\\$&')}$`),
        replacement: path.resolve(here, 'src/platform/node-shims/node-stubs.ts'),
      })),
      ...Object.entries({
      '@lumen/contracts': pkg('contracts', 'contracts/dist/index.js'),
      '@lumen/kernel': pkg('kernel', 'packages/kernel/dist/index.js'),
      '@lumen/scene': pkg('scene', 'packages/scene/dist/index.js'),
      '@lumen/rendering': pkg('rendering', 'packages/rendering/dist/index.js'),
      '@lumen/assets': pkg('assets', 'packages/assets/dist/index.js'),
      '@lumen/interaction': pkg('interaction', 'packages/interaction/dist/index.js'),
      '@lumen/config': pkg('config', 'packages/config/dist/index.js'),
      '@lumen/templates': pkg('templates', 'packages/templates/dist/index.js'),
      '@lumen/codegen': pkg('codegen', 'packages/codegen/dist/index.js'),
      '@lumen/runtime': pkg('runtime', 'packages/runtime/dist/index.js'),
      '@lumen/app-runtime': appRuntimeEntry,
      // App-layer platform packages (Phases 8–13) — consumed from built dists.
      '@lumen/app-projects': pkg('app-projects', 'app/projects/dist/index.js'),
      '@lumen/app-settings': pkg('app-settings', 'app/settings/dist/index.js'),
      '@lumen/app-telemetry': pkg('app-telemetry', 'app/telemetry/dist/index.js'),
      '@lumen/app-billing': pkg('app-billing', 'app/billing/dist/index.js'),
      '@lumen/app-entitlements': pkg('app-entitlements', 'app/entitlements/dist/index.js'),
      '@lumen/app-marketplace': pkg('app-marketplace', 'app/marketplace/dist/index.js'),
      '@lumen/app-assets': pkg('app-assets', 'app/assets/dist/index.js'),
      '@lumen/app-publish': pkg('app-publish', 'app/publish/dist/index.js'),
      '@lumen/app-onboarding': pkg('app-onboarding', 'app/onboarding/dist/index.js'),
      '@lumen/app-cli': pkg('app-cli', 'app/cli/dist/index.js'),
      // App-layer platform packages (Phases 14–19) — consumed from built dists.
      '@lumen/app-collaboration': pkg('app-collaboration', 'app/collaboration/dist/index.js'),
      '@lumen/app-ai': pkg('app-ai', 'app/ai/dist/index.js'),
      '@lumen/app-designer': pkg('app-designer', 'app/designer/dist/index.js'),
      '@lumen/app-dashboard': pkg('app-dashboard', 'app/dashboard/dist/index.js'),
      '@lumen/app-community': pkg('app-community', 'app/community/dist/index.js'),
      '@lumen/build': pkg('build', 'packages/build/dist/index.js'),
      // Browser shims for the node builtins exercised by @lumen/app-publish's
      // in-memory pipeline (StaticExporter → @lumen/build hashing/budgets).
      // sha256 digests match Node exactly; gzip sizes are a conservative
      // upper bound (stored deflate). Other node builtins stay externalized
      // (their code paths — NodeFsSink, CliExecutor — are never called in
      // the browser).
      'node:crypto': path.resolve(here, 'src/platform/node-shims/crypto.ts'),
      'node:zlib': path.resolve(here, 'src/platform/node-shims/zlib.ts'),
      'node:path': path.resolve(here, 'src/platform/node-shims/path.ts'),
      }).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  server: {
    fs: { allow: [path.resolve(here, '../..')] },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
