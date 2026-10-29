# Lumen Engine — Build SPEC (single source of truth)

This SPEC governs the swarm build. The full design rationale lives in:
- `/mnt/agents/output/web-engine-architecture.agent.final.md` (architecture)
- `/mnt/agents/output/lumen-swarm-agents.agent.final.md` (agent ownership & conflict rules)

## Repository layout

```
engine/
  contracts/            # @lumen/contracts — ALL cross-module types (frozen before Round 2)
  packages/
    kernel/             # @lumen/kernel — lifecycle, event bus, scheduler, capability detection, plugins
    rendering/          # @lumen/rendering — IRenderer impls (DOM, Canvas2D, WebGL), adaptive quality
    scene/              # @lumen/scene — scene graph, timeline, property binding
    assets/             # @lumen/assets — asset manifest handling, preloading, caching
    interaction/        # @lumen/interaction — input normalization, scroll virtualizer, bindings
    templates/          # @lumen/templates — TemplateDescriptors for the 4 frontend types
    codegen/            # @lumen/codegen — config -> code/bundle generation
    config/             # @lumen/config — EngineConfig schema, validation, migrations
    build/              # @lumen/build — build/export pipeline producing BuildArtifacts
  examples/
    simple-site/        # example config + generated output
  docs/                 # module READMEs live in packages/*/README.md; docs/ has guides
  tests/
    e2e/                # integration smoke tests
  index.ts              # single entry point (re-exports + createEngine)
```

## Sacred rules

1. **Contracts are sacred.** All cross-module types live ONLY in `contracts/src/`. Module agents consume them via `@lumen/contracts`. No agent may modify contracts; if a gap is found, implement a local adapter and note it in the module README.
2. **Ownership.** Each agent writes ONLY inside its own directory (plus its slice nothing else). No cross-directory writes.
3. **TypeScript, strict mode, ESM.** Target ES2022. Each package: `src/index.ts` public API, unit-runnable without a browser where feasible (DOM APIs behind guards).
4. **Zero required runtime deps** for kernel/scene/config/contracts; rendering may use Three.js behind dynamic import with a Canvas2D/DOM fallback; assets may use HLS.js behind dynamic import.
5. **Definition of Done per module:** `tsc` compiles against frozen contracts, public API exported from `src/index.ts`, README.md documents the module (responsibilities, API, usage example), no writes outside its directory.

## Round plan (orchestrator-enforced)

- Round 1: contracts freeze.
- Round 2 (parallel): kernel, config, scene, rendering / assets, interaction, templates, codegen, build.
- Round 3: integration (entry point `index.ts`, example `examples/simple-site`, e2e smoke test) + docs.
