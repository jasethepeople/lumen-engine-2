# Consolidated Agent Summary — Lumen Swarm

Condensed from the normative swarm spec
(`lumen-swarm-agents.agent.final.md`, v1.0) and mapped onto the actual
repository layout (see [SPEC.md](../SPEC.md)). Twelve agents: nine module
agents 1:1 with engine modules, plus three cross-cutting agents.

## Operating principles (non-negotiable)

1. **Ownership-based isolation** — every file has exactly one owning agent;
   cross-owner changes go through PR-style change requests.
2. **Contract-first collaboration** — the only shared surface is the typed
   contract layer (`contracts/src/*.ts`); no agent depends on another's
   implementation. Contract changes require a CCP with orchestrator approval
   and consumer sign-off.
3. **Orchestrator-mediated conflict resolution** — escalation ladder ending in
   orchestrator arbitration; interface-compatibility tests are the tiebreaker.

## The twelve agents

| Agent | Responsibilities (5 words) | Owned files | Key collaboration edge |
| --- | --- | --- | --- |
| Config Schema | Zod schemas, migrations, EngineConfig DSL | `packages/config/**`, `contracts/src/config.ts` | Publishes frozen `EngineConfig` → everyone |
| Kernel | Lifecycle, bus, scheduler, plugins, capabilities | `packages/kernel/**`, `contracts/src/kernel.ts` | Publishes `KernelContext`/events → all runtime agents |
| Rendering | Renderer backends, adaptive quality, frame adapter | `packages/rendering/**`, `contracts/src/rendering.ts` | Owns `RenderFrame` shape consumed by Scene Graph |
| Scene Graph | Scene hierarchy, dirty transforms, timeline eval | `packages/scene/**`, `contracts/src/scene.ts` | Produces draw list to Rendering's `RenderFrame` |
| Asset Pipeline | Manifest, preload, two-tier cache, loaders | `packages/assets/**`, `contracts/src/assets.ts` | `AssetManifest` → Templates, Build; textures → Rendering |
| Interaction | Input normalization, virtual scroller, a11y fallbacks | `packages/interaction/**`, `contracts/src/interaction.ts` | Timeline-seek drivers → Scene Graph (via bus) |
| Template | Descriptors, slots, themes, budgets, registry | `packages/templates/**`, `contracts/src/templates` slice | `ComposedScene` + `ModuleRequirement` → Codegen |
| Codegen | SceneIR lowering, targets, hydration manifest | `packages/codegen/**`, `contracts/src/codegen.ts` | `CodegenResult` → Build; re-exports contracts' IR |
| Build System | Pipeline, hashing, budgets, manifest, CI | `packages/build/**`, `contracts/src/build.ts`, workspace root | `BuildArtifact`/`BudgetReport` → Integration |
| Refactor (cross-cutting) | Codemods, migrations under orchestrator grant | `scripts/codemods/**`; grant-scoped writes only | Grant PRs reviewed/merged by each owner |
| Documentation (cross-cutting) | Docs, READMEs, ADRs, release notes | `docs/**`, `README.md`, `packages/*/README.md` | Reads TSDoc from all; docs freeze gates release |
| Integration (cross-cutting) | Contract tests, e2e, examples, release gate | `tests/contract/**`, `tests/e2e/**`, `examples/**` | Test gate blocks every agent's merge |

Notes on mapping: the spec's `contracts/*.d.ts` slices are implemented as
`contracts/src/*.ts` modules in the shipped `@lumen/contracts` package;
`packages/config-schema/` shipped as `packages/config/`,
`packages/scene-graph/` as `packages/scene/`, `packages/asset-pipeline/` as
`packages/assets/`. `packages/runtime/` (browser boot glue: `bootEngine`,
`hydrateIslands`, scrubber) is integration-layer code exercised through
Integration's e2e suites. One deliberate cross-module value dependency exists:
codegen → templates (theme helpers, refactor C3).

## Extending templates without touching the frozen default set

`TemplateKind` is frozen, so new template designs are specialization
descriptors that reuse an existing kind and register via
[`createExtendedRegistry()`](../packages/templates/src/registry.ts):

```ts
export function createExtendedRegistry(): TemplateRegistry {
  return createDefaultRegistry()
    .register(scrollCinemaLandingTemplate)   // kind 'scroll-video'
    .register(cinematicStoryTemplate);       // kind 'cinematic-spa'
}
```

Because the registry keys descriptors by kind, the specializations **replace**
the stock descriptors for their kinds in the extended registry; they are
distinguished by descriptor id/version and node-meta namespacing
(`meta['scroll-cinema-landing']`, `meta['cinematic-story']`).
`createDefaultRegistry()` stays frozen/unchanged for compatibility. To add a
new template: author a plain-TS `TemplateDescriptor`, keep its `kind` within
the frozen union, and register it in your own (or the extended) registry —
see [guide/07-template-designs.md](guide/07-template-designs.md) and
[guide/02-custom-templates.md](guide/02-custom-templates.md).

## Process essentials

- **Rounds**: (1) foundation contracts frozen (Config + Kernel) →
  (2) runtime modules in parallel → (3) build-time agents →
  (4) integration gate → (5) docs & release. No implementation against
  unfrozen contracts.
- **CCP workflow**: propose → impact analysis (one cycle) → orchestrator
  decision → migration plan (Refactor) for breaking changes → freeze/publish.
  Contract semver: patch = docs/widened optionals; minor = additive; major =
  breaking + migration plan.
- **Integration gate** (merge/release): contract tests green, e2e green per
  template kind, budgets verified by `BudgetReport`, zero unresolved CCPs,
  docs freeze satisfied.
- **Definition of Done**: types compile, unit + contract tests pass, TSDoc
  updated, budgets hold.
- **Current state (v0.2)**: gate green — build clean, e2e 8/8, package tests
  214/0, example budgets passed (see
  [stabilization-report.md](stabilization-report.md)).
