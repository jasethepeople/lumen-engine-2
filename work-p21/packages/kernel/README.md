# @lumen/kernel

The Lumen engine kernel: lifecycle state machine, typed event bus, cooperative
frame scheduler, capability detection, plugin registry, and error boundaries.
Everything else in the engine builds on this package. Zero runtime
dependencies, strict TypeScript, ESM, and fully runnable/testable outside a
browser (all DOM access is behind guards and injectable).

## Responsibilities

- **Lifecycle** (`src/lifecycle.ts`) — state machine over the frozen
  `LifecyclePhase` union: `created → booting → loading → ready → active ⇄
  paused → disposed`. Illegal transitions throw a structured `EngineError`;
  valid ones emit `lifecycle:change` / `lifecycle:enter` / `lifecycle:leave`.
- **Event bus** (`src/event-bus.ts`) — strongly typed pub/sub over
  `EngineEventMap` (`on` / `off` / `once` / `emit`), wildcard listeners via
  `onAny`, and error isolation: a throwing listener is reported to the
  `onListenerError` hook and never breaks `emit` for other listeners.
- **Capabilities** (`src/capabilities.ts`) — one-shot, immutable
  `CapabilityProfile`: WebGL2/WebGPU/OffscreenCanvas probing, codec probing via
  `MediaCapabilities.decodingInfo()` (guarded, with a static fallback table),
  `deviceMemory`, `prefers-reduced-motion`, and DPR envelope. Pure functions
  over an injectable `CapabilityEnvironment`; safe no-DOM fallback.
- **Scheduler** (`src/scheduler.ts`) — single rAF loop with an injectable
  clock and frame source, prioritized per-frame callbacks, frame-budget
  enforcement (default 16 ms) emitting `scheduler:budget-exceeded` with a
  `BudgetReport`, and an adaptive degradation hook (`onDegrade`) after
  sustained overruns.
- **Plugins** (`src/plugin.ts`) — registry for `LumenPlugin`s; resolves the
  `provides`/`consumes` token DAG, initializes in topological order with a
  narrowed `KernelContext`, disposes in reverse order. Cycles, missing
  providers, and duplicate names raise structured errors.
- **Errors** (`src/errors.ts`) — `EngineError` construction/normalization
  helpers and `guard` / `guardAsync` error boundaries wrapping module/plugin
  init; contained failures are reported via `engine:error`.

## Public API

```ts
import { createKernel } from '@lumen/kernel';

const kernel = createKernel({
  scheduler: { budgetMs: 16 }, // clock/rAF injectable for tests & workers
});

kernel.registerPlugin({
  name: 'analytics',
  version: '1.0.0',
  init(ctx) {
    // KernelContext: { capabilities, events, reportError }
    if (!ctx.capabilities.reducedMotion) {
      ctx.events('timeline:seek', ({ time }) => track(time));
    }
  },
  dispose() {},
});

kernel.on('scheduler:budget-exceeded', (r) => console.warn(r.frameMs, r.phase));
kernel.on('engine:error', (err) => reportToTelemetry(err));

await kernel.boot();    // created → booting → loading → ready → active
kernel.suspend();       // active → paused (frame loop stops)
kernel.resume();        // paused → active
await kernel.dispose(); // → disposed; plugins disposed in reverse order
```

`createKernel()` returns a `Kernel`, which extends the frozen `KernelHandle`
contract (`phase`, `capabilities`, `start`/`pause`/`resume`/`dispose`, `on`)
with internal surfaces: `bus`, `scheduler`, `plugins`, `lifecycle`,
`registerPlugin()`, and the `boot()`/`suspend()` aliases. Consumers that only
need the contract (e.g. `createEngine`) should type against `KernelHandle`.

## Collaboration notes

- **Everyone consumes** the typed event bus: all cross-module communication
  flows through `EngineEventMap` events. Never import another runtime module
  directly; publish/subscribe instead.
- **rendering, scene, assets, interaction** receive a `KernelContext`
  (capabilities + `events` + `reportError`) via plugin `init`, or the full
  `KernelHandle` from `createEngine`. `CapabilityProfile` is immutable and
  computed once at boot.
- **rendering** consumes `scheduler` frames (register render work at priority
  ~30) and `scheduler:budget-exceeded` for adaptive quality
  (`render:quality-change`). The scheduler's `onDegrade` hook is the kernel's
  own adaptive lever.
- **assets** publishes `asset:progress` during the `loading` phase.
- **All modules** must wrap init in the provided error boundaries (or
  `reportError`) so failures surface as `engine:error` with the right
  `module`/`code` and trigger configured fallbacks instead of crashing.

### Contract adapter notes

- `KernelHandle` uses `start`/`pause`; `boot()`/`suspend()` are provided as
  aliases. Lifecycle phases follow the frozen contract (`created`, `booting`,
  …, `paused`), not the earlier `init`/`suspended` draft naming.
- `tsconfig.json` maps `@lumen/contracts` to `../../contracts/dist/index.d.ts`
  (not `src/index.ts`): pulling the contracts *source* into this compilation
  violates `rootDir` (TS6059). Build contracts first
  (`tsc -p ../../contracts`), then `tsc -p tsconfig.json` compiles cleanly.

## Scripts

```sh
npm run build   # tsc -p tsconfig.json (requires contracts/dist to be built)
npm test        # build + node --test test/
```

## Build convention

This package follows the engine-wide unified build convention: `tsconfig.json`
is the only build config (`extends ../../tsconfig.base.json`, `rootDir: "src"`,
flat `dist/` output, `@lumen/contracts` resolved against `contracts/dist`),
`npm run build` compiles, `npm run typecheck` checks without emit, and
`npm test` builds then runs `node --test test/`. Build order (contracts first)
is owned by `scripts/build-all.sh` at the repo root.
