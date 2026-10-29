# GitHub Packaging — Lumen Engine v0.2

This document is the packaging checklist for publishing/cloning the Lumen
engine repository: what the tree actually looks like, how a fresh clone gets
from zero to a passing build, and how the requested layout names map onto the
real layout.

## Clone → green checklist

```sh
git clone <repo> && cd lumen-engine

# 1. Build everything (contracts first, then packages in dependency order,
#    then the runtime + root entry point, then node_modules/@lumen shims).
bash scripts/build-all.sh        # sets up tsc discovery; or: npm run build

# 2. Run every package test suite (node --test, against compiled dists).
for d in packages/*/; do node --test "$d/test/"; done
#    @lumen/build additionally has TS-authored tests:
(cd packages/build && tsc -p tsconfig.test.json && node --test dist-test/test/)

# 3. End-to-end suite (8 tests): config → compose → codegen → build → runtime.
node --test tests/e2e/           # or: npm test

# 4. Rebuild the example sites (budget reports must read `budgets passed: true`).
node examples/simple-site/build-example.mjs
node examples/cinematic-story/build-example.mjs
node examples/scroll-cinema-landing/build-example.mjs
```

TypeScript discovery order for `build-all.sh`: `$LUMEN_TSCJS`, then
`node_modules/typescript/lib/tsc.js`, then `$HOME/tools/typescript/lib/tsc.js`.
`@types/node` is provisioned from `$HOME/tools/@types` when missing.
Node >= 20 is required (see `engines` in package.json).

## Real repository tree

Generated with:
`find . -path ./node_modules -prune -o -path ./.git -prune -o -type d -name dist -prune -o -type f -print | sort`
(compiled `dist/` directories omitted except the committed example evidence,
see the layout mapping below).

```
.gitignore
LICENSE
README.md
SPEC.md
contracts/.gitignore
contracts/README.md
contracts/package.json
contracts/src/assets.ts
contracts/src/build.ts
contracts/src/codegen.ts
contracts/src/config.ts
contracts/src/index.ts
contracts/src/interaction.ts
contracts/src/ir.ts
contracts/src/kernel.ts
contracts/src/rendering.ts
contracts/src/scene.ts
contracts/src/templates.ts
contracts/tsconfig.json
docs/api-index.md
docs/architecture.md
docs/extending.md
docs/getting-started.md
docs/github-packaging.md
docs/guide/01-overview.md
docs/guide/02-custom-templates.md
docs/guide/03-writing-configs.md
docs/guide/04-building-and-export.md
docs/guide/05-example-scroll-video.md
docs/guide/07-template-designs.md
docs/guide/README.md
docs/refactor-changelog.md
docs/stabilization-report.md
docs/templates.md
examples/cinematic-story/build-example.mjs
examples/cinematic-story/engine.config.json
examples/scroll-cinema-landing/build-example.mjs
examples/scroll-cinema-landing/engine.config.json
examples/simple-site/README.md
examples/simple-site/build-example.mjs
examples/simple-site/engine.config.json
index.ts
package-lock.json
package.json
packages/assets/.gitignore
packages/assets/README.md
packages/assets/package.json
packages/assets/src/{cache,index,loader,manager,manifest,preload}.ts
packages/assets/test/{cache,fixtures,manifest,preload,qa-regression,queue}.test.mjs / fixtures.mjs
packages/assets/tsconfig.json
packages/build/.gitignore
packages/build/README.md
packages/build/package.json
packages/build/src/{budgets,build,hash,index,pipeline,report,targets,vendor}.ts
packages/build/test/{budgets,hash,pipeline}.test.ts + {pipeline-manifest,vendor}.test.mjs
packages/build/tsconfig.json
packages/build/tsconfig.test.json
packages/codegen/.gitignore
packages/codegen/README.md
packages/codegen/package.json
packages/codegen/src/{codegen,common,emit,gen-npm,gen-runtime,gen-static,gen-webcomponent,index,ir}.ts
packages/codegen/test/{codegen,qa-regression}.test.mjs + fixtures.mjs
packages/codegen/tsconfig.json
packages/config/README.md
packages/config/package.json
packages/config/src/{defaults,index,migrations,parse,schema,validate}.ts
packages/config/test/config.test.mjs
packages/config/tsconfig.json
packages/interaction/.gitignore
packages/interaction/README.md
packages/interaction/package.json
packages/interaction/src/{bindings,gestures,index,manager,normalize,scroll}.ts
packages/interaction/test/{bindings,gestures,manager,normalize,qa-regression,scroll}.test.mjs
packages/interaction/tsconfig.json
packages/kernel/.gitignore
packages/kernel/README.md
packages/kernel/package.json
packages/kernel/src/{capabilities,errors,event-bus,index,kernel,lifecycle,plugin,scheduler}.ts
packages/kernel/test/{event-bus,kernel,lifecycle}.test.mjs
packages/kernel/tsconfig.json
packages/rendering/.gitignore
packages/rendering/README.md
packages/rendering/package.json
packages/rendering/src/{errors,frame-adapter,index,quality,renderer-canvas2d,renderer-dom,renderer-webgl,select}.ts
packages/rendering/test/{dom-transform,pooling,quality,select}.test.mjs
packages/rendering/tsconfig.json
packages/runtime/README.md
packages/runtime/package.json
packages/runtime/src/{engine,index,ir,scrub}.ts
packages/runtime/test/{ir,scrub}.test.mjs
packages/runtime/tsconfig.json
packages/scene/.gitignore
packages/scene/README.md
packages/scene/package.json
packages/scene/src/{binding,graph,index,math,runtime,timeline}.ts
packages/scene/test/{binding,graph,timeline}.test.mjs
packages/scene/tsconfig.json
packages/templates/README.md
packages/templates/package.json
packages/templates/src/{cinematic-spa,cinematic-story,index,internal,registry,scroll-cinema-landing,scroll-video,storytelling,theme,viewer-3d}.ts
packages/templates/test/{cinematic-spa,cinematic-story,qa-regression,registry,scroll-cinema-landing,scroll-video,storytelling,theme,viewer-3d}.test.mjs + fixtures.mjs
packages/templates/tsconfig.json
qa-report.md
refactor-proposal.md
scripts/build-all.sh
scripts/link-workspaces.mjs
tests/e2e/qa-scrub-vendor.test.mjs
tests/e2e/smoke.test.mjs
tsconfig.base.json
tsconfig.build.json
```

Additionally committed as build evidence: `examples/*/dist/**` (generated
HTML/JS/manifests plus the vendored runtime — see below).

## Layout mapping (requested names → actual names)

| Requested layout name            | Actual location |
| -------------------------------- | --------------- |
| `src/*` / `lib/*` engine modules | `packages/*` workspaces (`kernel`, `scene`, `rendering`, `assets`, `interaction`, `templates`, `config`, `codegen`, `build`, `runtime`) plus the frozen `contracts/` package |
| `templates/internal` helpers     | `packages/templates/src/internal.ts` (shared composition helpers; `normalizeScrollRange`, `assembleScene`, `resolveBindings`, …) |
| `vendor/` runtime copies         | **Generated**, not source: created inside each example's `dist/vendor/` by the build pipeline (`packages/build/src/vendor.ts`) so static exports run unbundled |
| SceneIR schema                   | `contracts/src/ir.ts` (types, frozen wire format) + `packages/runtime/src/ir.ts` (validation/raising behavior) |
| Entry point                      | root `index.ts` → compiled to root `dist/index.js` |

## Housekeeping guarantees

- `LICENSE` is MIT, copyright "Lumen Engine Contributors", 2026.
- `.gitignore`: `node_modules/`, `dist/` with a `!examples/*/dist/` negation
  (example dists are committed evidence), `*.tsbuildinfo`, `.DS_Store`.
- `git ls-files | grep node_modules` is empty — no dependencies are tracked.
- `manifest.json` in every build output carries `engineVersion` +
  `generatedAt`; `hydration-manifest.json` carries `irVersion`.
