# Lumen Developer Guide

A practical, task-oriented guide set for developers who know JavaScript and
are new to the Lumen engine. Read in order; each guide stands alone too.

1. [Overview](01-overview.md) — what Lumen is, the pipeline mental model,
   module map, when (not) to use it.
2. [Custom templates](02-custom-templates.md) — write, register, and ship
   your own `TemplateDescriptor`.
3. [Writing configs](03-writing-configs.md) — the `EngineConfig`, field by
   field, with defaults, validation errors, and migrations.
4. [Building and exporting](04-building-and-export.md) — the four export
   targets, build scripts, budgets, and the output layout.
5. [Worked example: scroll-video](05-example-scroll-video.md) — a complete
   site from config to built output, with variations and troubleshooting.
6. [Template designs](07-template-designs.md) — the `scroll-cinema-landing`
   and `cinematic-story` specialization descriptors: schemas, mappings,
   examples, and generated output.

Deeper reference material:

- [../getting-started.md](../getting-started.md) — zero to built site in four steps.
- [../architecture.md](../architecture.md) — module map and data flow.
- [../templates.md](../templates.md) — the four built-in templates and their slots.
- [../extending.md](../extending.md) — plugins, custom renderers, contract changes.
- [../api-index.md](../api-index.md) — exported symbols per package.
- [../consolidated-architecture.md](../consolidated-architecture.md) — one-page stabilized architecture + invariants checklist.
- [../consolidated-agents.md](../consolidated-agents.md) — the twelve-agent swarm in one table.
