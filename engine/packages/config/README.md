# @lumen/config

Configuration schema, validation, defaults, and migrations for the Lumen engine.

## Responsibilities

- Validates author-authored config files against the frozen `EngineConfig`
  contract (`@lumen/contracts`, `contracts/src/config.ts`).
- Reports **every** problem in one pass with precise JSON paths
  (e.g. `scenes[0].track.driver`), suitable for build logs and CMS surfacing.
- Upgrades legacy configs through a linear, versioned migration registry
  (v0 → v3) and reports which migrations were applied.
- Applies sensible defaults (build flags, theme tokens, per-kind preload
  strategy) without overriding explicitly authored values.
- Zero runtime dependencies: the validator is a small hand-rolled
  combinator toolkit (`src/validate.ts`) — no zod.

## API

```ts
import {
  parseConfig,        // top-level entry: object | JSON/JSONC string → result
  validateConfig,     // raw object → { ok:true, config } | { ok:false, errors }
  migrate, migrations,// migration runner + registry
  applyDefaults,      // deep-merge defaults applicator
  CONFIG_VERSION,     // current schema version (3)
} from '@lumen/config';

const result = parseConfig(rawSource);
if (result.ok) {
  result.config;            // fully typed EngineConfig, defaults applied
  result.appliedMigrations; // e.g. ['0→1', '1→2', '2→3']
} else {
  result.errors;            // [{ path, message }] with JSON paths
}
```

`parseConfig` accepts a plain object or a JSON/JSONC string (comments are
stripped before parsing) and runs **migrate → validate → defaults**.

## Consumers

The **Codegen**, **Template**, and **Build** agents consume `parseConfig`
as the single entry point: feed it the authored config file contents and
branch on `result.ok`. Downstream stages should treat `result.config` as
the single source of truth and surface `appliedMigrations` as deprecation
warnings in build logs.

## Layout

- `src/validate.ts` — composable validator combinators
  (`object`/`string`/`number`/`boolean`/`enumOf`/`array`/`optional`/`union`/`tuple`/`recordOf`)
- `src/schema.ts` — full `EngineConfig` schema + cross-field invariants
  (unique ids, interaction→scene and node→asset references, node-kind rules)
- `src/defaults.ts` — defaults applicator (`deepMerge`, theme/build/preload)
- `src/migrations.ts` — linear migration registry and runner
- `src/parse.ts` — `parseConfig` + JSONC comment stripping
- `test/config.test.mjs` — unit tests (`node --test`) against compiled output

## Development

```sh
npx tsc -p tsconfig.json        # typecheck + emit to dist/
node --test test/               # run unit tests
npm test                        # build + test
```

## Build convention

This package follows the engine-wide unified build convention: `tsconfig.json`
is the only build config (`extends ../../tsconfig.base.json`, `rootDir: "src"`,
flat `dist/` output, `@lumen/contracts` resolved against `contracts/dist`),
`npm run build` compiles, `npm run typecheck` checks without emit, and
`npm test` builds then runs `node --test test/`. Build order (contracts first)
is owned by `scripts/build-all.sh` at the repo root.
