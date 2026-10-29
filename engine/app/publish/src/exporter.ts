/**
 * @lumen/app-publish — StaticExporter.
 *
 * Runs the engine front half (parseConfig → template registry → compose)
 * plus @lumen/codegen generate(), then reuses @lumen/build's planning /
 * hashing / budget machinery to produce a static bundle entirely in memory —
 * the same seam examples/simple-site/build-example.mjs walks, packaged as a
 * reusable API with a pluggable output sink (MemorySink by default,
 * NodeFsSink to materialize a directory).
 *
 * The bundle is { files: Map<path, string>, manifest, budgets } where
 * `manifest` mirrors the DeployManifest shape emitted by @lumen/build for the
 * static target (entry, per-file size/hash metadata, generatedAt).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  BuildBudgetReport,
  BudgetMetric,
  EngineConfig,
  SizeBudget,
} from '@lumen/contracts';
import { parseConfig } from '@lumen/config';
import { createExtendedRegistry, type TemplateRegistry } from '@lumen/templates';
import { generate } from '@lumen/codegen';
import { manifestFromAssetRefs } from '@lumen/runtime';
import {
  checkBudgets,
  contentHash,
  gzipSize,
  hashPlannedFiles,
  resolveStrategy,
  LUMEN_ENGINE_VERSION,
  type DeployManifest,
  type MinifyHook,
  type PlannedFile,
} from '@lumen/build';

/** A single budget violation (metric over budget). */
export interface BudgetViolation {
  metric: BudgetMetric;
  budget: number;
  actual: number;
}

/** Thrown when a static bundle fails its size budgets. */
export class BudgetExceededError extends Error {
  override readonly name = 'BudgetExceededError';
  readonly violations: readonly BudgetViolation[];
  readonly report: BuildBudgetReport;

  constructor(report: BuildBudgetReport) {
    const violations: BudgetViolation[] = report.checks
      .filter((c) => c.actual > c.budget)
      .map((c) => ({ metric: c.metric, budget: c.budget, actual: c.actual }));
    super(
      `budgets exceeded: ${violations
        .map((v) => `${v.metric}: ${v.actual} > ${v.budget}`)
        .join('; ')}`,
    );
    this.violations = violations;
    this.report = report;
  }
}

/** Thrown when the config passed to StaticExporter fails validation. */
export class InvalidConfigError extends Error {
  override readonly name = 'InvalidConfigError';
  readonly errors: readonly { path: string; message: string }[];

  constructor(errors: readonly { path: string; message: string }[]) {
    super(`config invalid: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    this.errors = errors;
  }
}

/** Output sink: receives the final bundle, file by file. */
export interface ExportSink {
  write(path: string, content: string | Uint8Array): void | Promise<void>;
}

/** In-memory sink (default) — accumulates files in a Map. */
export class MemorySink implements ExportSink {
  readonly files = new Map<string, string | Uint8Array>();

  write(path: string, content: string | Uint8Array): void {
    this.files.set(path, content);
  }
}

/** Filesystem sink — materializes the bundle under a directory. */
export class NodeFsSink implements ExportSink {
  readonly outDir: string;

  constructor(outDir: string) {
    if (typeof outDir !== 'string' || outDir.trim() === '') {
      throw new Error('NodeFsSink: outDir must be a non-empty string');
    }
    this.outDir = outDir;
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    const abs = join(this.outDir, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}

/** The static bundle produced by StaticExporter. */
export interface StaticBundle {
  /** Output-relative path → content (manifest.json included). */
  files: Map<string, string | Uint8Array>;
  /** Deploy manifest (same shape as @lumen/build's manifest.json). */
  manifest: DeployManifest;
  /** Budget gate result for the bundle. */
  budgets: BuildBudgetReport;
  /** Primary entry path (content-hashed). */
  entry: string;
  /** Content hash of the canonical serialized EngineConfig. */
  configHash: string;
}

/** Project-like input: an EngineConfig, or {id, name, config}. */
export type PublishableProject = EngineConfig | { id: string; name: string; config: EngineConfig };

/** Options accepted by StaticExporter.export(). */
export interface StaticExportOptions {
  /** Template registry override; defaults to createExtendedRegistry(). */
  registry?: TemplateRegistry;
  /** Budgets to enforce; defaults to @lumen/build's DEFAULT_BUDGETS. */
  budgets?: readonly SizeBudget[];
  /** Fail (throw BudgetExceededError) when any budget check fails. Default false. */
  strictBudgets?: boolean;
  /** Output sink; defaults to a fresh MemorySink. */
  sink?: ExportSink;
  /** Pluggable minify hooks (optimize phase). */
  minifyHooks?: readonly MinifyHook[];
}

function isEngineConfig(input: PublishableProject): input is EngineConfig {
  return typeof (input as EngineConfig).template === 'string';
}

/** Serialize a config deterministically (sorted keys) for hashing. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Hash of the canonical serialized EngineConfig (for publish records). */
export function configHashOf(config: EngineConfig): string {
  return contentHash(canonicalJson(config));
}

export class StaticExporter {
  readonly #registry: TemplateRegistry;

  constructor(options: { registry?: TemplateRegistry } = {}) {
    this.#registry = options.registry ?? createExtendedRegistry();
  }

  /**
   * Produce a static bundle from an EngineConfig (or project-like wrapper).
   * Pure in-memory pipeline: validate → compose → generate → plan → hash →
   * budgets → sink. Never touches the network.
   */
  async export(project: PublishableProject, options: StaticExportOptions = {}): Promise<StaticBundle> {
    const rawConfig = isEngineConfig(project) ? project : project.config;

    // 1. Validate through @lumen/config (migrations + defaults applied).
    const parsed = parseConfig(rawConfig);
    if (!parsed.ok) throw new InvalidConfigError(parsed.errors);
    const config = parsed.config;

    // 2. Template composition.
    const registry = options.registry ?? this.#registry;
    const descriptor = registry.require(config.template);
    const assetManifest = manifestFromAssetRefs(config.assets);
    const composedScene = descriptor.compose(config, assetManifest);

    // 3. Codegen for the static target (import map + vendored @lumen runtime).
    const target = { ...config.build, target: 'static' as const };
    const result = generate(config, descriptor, composedScene, {
      target,
      sourcemaps: false,
      emitTypeScript: false,
    });

    // 4. Plan + optional minify + content-hash (reusing @lumen/build).
    const strategy = resolveStrategy('static');
    let planned: PlannedFile[] = strategy.plan(result);
    const hooks = options.minifyHooks ?? [];
    if (target.minify !== false && hooks.length > 0) {
      const out: PlannedFile[] = [];
      for (const file of planned) {
        let content = file.content;
        if (/\.(js|mjs|cjs|css|html|json)$/i.test(file.path)) {
          for (const hook of hooks) content = await hook(content, file.path);
        }
        out.push({ ...file, content });
      }
      planned = out;
    }
    const { files: hashedAll, renames } = hashPlannedFiles(planned);
    // The static target can plan the same output path twice (e.g. the SSR
    // shell and the entry html); the fs pipeline would overwrite on disk, so
    // the in-memory bundle keeps the last write — dedupe to match.
    const byPath = new Map<string, PlannedFile>();
    for (const f of hashedAll) byPath.set(f.path, f); // last write wins, like disk
    const hashed = [...byPath.values()];
    const entryPlanned = strategy.entryPath(result);
    const entry = renames.get(entryPlanned) ?? entryPlanned;

    // 5. Budgets over the hashed file set.
    const measured = hashed.map((f) => ({
      path: f.path,
      bytes: Buffer.byteLength(f.content, 'utf8'),
      gzipBytes: gzipSize(f.content),
      hash: contentHash(f.content),
      role: f.role,
    }));
    const evaluation = checkBudgets(measured, options.budgets);
    if ((options.strictBudgets ?? false) && !evaluation.report.passed) {
      throw new BudgetExceededError(evaluation.report);
    }

    // 6. Manifest + sink emission.
    const manifest: DeployManifest = {
      target: 'static',
      entry,
      files: measured.map((f) => ({ ...f })),
      generatedAt: new Date().toISOString(),
      engineVersion: LUMEN_ENGINE_VERSION,
    };

    const sink = options.sink ?? new MemorySink();
    const files = new Map<string, string | Uint8Array>();
    for (const file of hashed) {
      files.set(file.path, file.content);
      await sink.write(file.path, file.content);
    }
    if (strategy.emitManifest) {
      const manifestJson = JSON.stringify(manifest, null, 2);
      files.set('manifest.json', manifestJson);
      await sink.write('manifest.json', manifestJson);
    }

    return {
      files,
      manifest,
      budgets: evaluation.report,
      entry,
      configHash: configHashOf(config),
    };
  }
}
