/**
 * @lumen/build — the build pipeline.
 *
 * Phases (in order, each timed):
 *   1. validate  — check the target descriptor and options.
 *   2. generate  — invoke the injected codegen `generate()` (the Integration
 *                  layer wires @lumen/codegen's generate here; @lumen/build
 *                  never imports codegen directly, only the contracts types).
 *   3. optimize  — apply pluggable minify hooks (per-extension) when the
 *                  target requests minification.
 *   4. hash      — content-addressed filenames (SHA-256) + quoted-specifier
 *                  rewriting inside emitted JS/HTML over the known import graph.
 *   5. emit      — write outDir, materialize manifest.json, clean stale files
 *                  left over from previous builds of the same target.
 *   6. report    — measure gzip sizes, evaluate budgets, build the report.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';

import type {
  ArtifactFile,
  BuildArtifact,
  CodegenOptions,
  CodegenResult,
  CodegenTarget,
  SizeBudget,
} from '@lumen/contracts';

import { checkBudgets, gzipSize, type BudgetEvaluation, type CheckBudgetsOptions } from './budgets.js';
import { contentHash, hashedFilename, rewriteImportPaths } from './hash.js';
import { formatReportJson, formatReportText, type BuildReportData, type PhaseTimings } from './report.js';
import { isTargetKind, resolveStrategy, type PlannedFile } from './targets.js';
import { vendorRuntimePackages } from './vendor.js';

/** Signature of the injected codegen entry point (matches @lumen/codegen). */
export type GenerateFn = (options: CodegenOptions) => Promise<CodegenResult> | CodegenResult;

/**
 * A pluggable minify hook. Receives the file content and its planned path and
 * returns optimized content. Hooks run in registration order.
 */
export type MinifyHook = (content: string, path: string) => Promise<string> | string;

/** Context for one pipeline run. */
export interface PipelineContext {
  /** Absolute or cwd-relative output directory for this target. */
  outDir: string;
  /** Registered minify hooks (optimize phase). */
  minifyHooks?: readonly MinifyHook[];
  /** Emit *.map companion files derived from generated module sourcemaps. */
  sourcemaps?: boolean;
  /** Fail (throw) when any budget check fails. */
  strictBudgets?: boolean;
  /** Budgets to enforce; defaults to the architecture budgets. */
  budgets?: readonly SizeBudget[];
  /** Externally measured runtime metrics (Lighthouse etc.). */
  measuredMetrics?: CheckBudgetsOptions['measured'];
  /** Environment marker, e.g. 'ci' | 'local'. */
  environment?: string;
  /** Remove stale files from previous builds (default true). */
  clean?: boolean;
  /**
   * Copy the compiled @lumen/* runtime packages into `<outDir>/vendor/<name>/`
   * so the emitted import map resolves unbundled. Default: on for the
   * 'static' target, off otherwise. Vendored bytes are excluded from budgets.
   */
  vendorRuntime?: boolean;
  /** Optional sink for the human-readable report. */
  onReport?: (text: string) => void;
}

/** Manifest.json payload emitted for deploy tooling. */
export interface DeployManifest {
  target: string;
  entry: string;
  files: Array<{ path: string; bytes: number; gzipBytes: number; hash: string; role: string }>;
  generatedAt: string;
}

const MANIFEST_NAME = 'manifest.json';

function validate(target: CodegenTarget, ctx: PipelineContext): void {
  if (!isTargetKind(target.target)) {
    throw new Error(`build: unknown target '${String(target.target)}'`);
  }
  if (typeof ctx.outDir !== 'string' || ctx.outDir.trim() === '') {
    throw new Error('build: outDir must be a non-empty string');
  }
  if (target.moduleFormat !== undefined && !['esm', 'cjs', 'iife'].includes(target.moduleFormat)) {
    throw new Error(`build: unsupported moduleFormat '${target.moduleFormat}'`);
  }
}

/**
 * Hash phase: rename hashable files to content-addressed names and rewrite
 * quoted specifiers in JS/HTML files that reference renamed files.
 * Pure function over the planned file list — no I/O.
 */
export function hashPlannedFiles(files: PlannedFile[]): {
  files: PlannedFile[];
  renames: Map<string, string>;
} {
  const renames = new Map<string, string>();
  const renamed: PlannedFile[] = files.map((file) => {
    if (!file.hashed) return { ...file };
    const hash = contentHash(file.content);
    const next = hashedFilename(file.path, hash);
    renames.set(file.path, next);
    return { ...file, path: next };
  });

  // Rewrite specifiers inside text files that reference renamed siblings.
  // Basename-only specifiers ('./chunk.js') are normalized to their planned
  // path so they match the rename map.
  const rewritten = renamed.map((file) => {
    if (!/\.(js|mjs|cjs|html)$/i.test(file.path)) return file;
    const dir = posix.dirname(file.path);
    const scoped = new Map<string, string>();
    for (const [from, to] of renames) {
      scoped.set(from, to);
      const rel = posix.relative(dir, from);
      const spec = rel.startsWith('.') ? rel : `./${rel}`;
      const relTo = posix.relative(dir, to);
      scoped.set(spec, relTo.startsWith('.') ? relTo : `./${relTo}`);
    }
    const { source } = rewriteImportPaths(file.content, scoped);
    return source === file.content ? file : { ...file, content: source };
  });

  return { files: rewritten, renames };
}

/** Run the full pipeline for one target. */
export async function runPipeline(
  target: CodegenTarget,
  generate: GenerateFn,
  ctx: PipelineContext,
): Promise<BuildArtifact> {
  const timings: PhaseTimings = {};
  const time = async <T>(phase: string, fn: () => T | Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      timings[phase] = (timings[phase] ?? 0) + (performance.now() - start);
    }
  };

  // 1. validate
  await time('validate', () => validate(target, ctx));
  const strategy = resolveStrategy(target.target);

  // 2. generate
  const result = await time('generate', () =>
    generate({ target, sourcemaps: ctx.sourcemaps ?? false, emitTypeScript: false }),
  );

  // 3. optimize (pluggable minify hooks)
  const hooks = ctx.minifyHooks ?? [];
  const minified = await time('optimize', async (): Promise<PlannedFile[]> => {
    const planned = strategy.plan(result);
    if (target.minify === false || hooks.length === 0) return planned;
    const out: PlannedFile[] = [];
    for (const file of planned) {
      let content = file.content;
      if (/\.(js|mjs|cjs|css|html|json)$/i.test(file.path)) {
        for (const hook of hooks) content = await hook(content, file.path);
      }
      out.push({ ...file, content });
    }
    return out;
  });

  // 4. hash
  const { files: hashed, renames } = await time('hash', () => hashPlannedFiles(minified));
  const entryPlanned = strategy.entryPath(result);
  const entry = renames.get(entryPlanned) ?? entryPlanned;

  // 5. emit (write outDir, manifest.json, clean stale)
  const files = await time('emit', async (): Promise<ArtifactFile[]> => {
    await mkdir(ctx.outDir, { recursive: true });

    const emitted: ArtifactFile[] = [];
    for (const file of hashed) {
      const abs = join(ctx.outDir, file.path);
      await mkdir(join(abs, '..'), { recursive: true });
      await writeFile(abs, file.content, 'utf8');
      emitted.push({
        path: file.path,
        bytes: Buffer.byteLength(file.content, 'utf8'),
        gzipBytes: gzipSize(file.content),
        hash: contentHash(file.content),
        role: file.role,
      });
    }

    if (strategy.emitManifest) {
      const manifest: DeployManifest = {
        target: target.target,
        entry,
        files: emitted.map((f) => ({ ...f })),
        generatedAt: new Date().toISOString(),
      };
      await writeFile(join(ctx.outDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2), 'utf8');
    }

    // Vendor the runtime packages for unbundled consumption. Vendored files
    // are kept out of `emitted` (excluded from budgets + deploy manifest) but
    // participate in stale-clean.
    const vendored =
      (ctx.vendorRuntime ?? target.target === 'static')
        ? await vendorRuntimePackages(ctx.outDir)
        : [];

    if (ctx.clean !== false) {
      await cleanStale(
        ctx.outDir,
        new Set([...emitted.map((f) => f.path), ...vendored, MANIFEST_NAME]),
      );
    }
    return emitted;
  });

  // 6. report
  const artifact = await time('report', async (): Promise<BuildArtifact> => {
    const evaluation: BudgetEvaluation = checkBudgets(files, ctx.budgets, {
      measured: ctx.measuredMetrics,
    });
    if (ctx.strictBudgets && !evaluation.report.passed) {
      const failed = evaluation.outcomes
        .filter((o) => o.status === 'fail')
        .map((o) => `${o.metric}: ${o.actual} > ${o.budget}`)
        .join('; ');
      throw new Error(`build: size budgets failed (strictBudgets) — ${failed}`);
    }
    const data: BuildReportData = {
      target: target.target,
      outDir: ctx.outDir,
      entry,
      files,
      budgets: evaluation.report,
      outcomes: evaluation.outcomes,
      warnings: result.warnings,
      budgetNotes: evaluation.notes,
      timings,
      environment: ctx.environment ?? 'local',
      sourcemaps: ctx.sourcemaps ?? false,
    };
    const text = formatReportText(data);
    ctx.onReport?.(text);
    return {
      target: target.target,
      outDir: ctx.outDir,
      entry,
      files,
      budgets: evaluation.report,
      report: JSON.parse(formatReportJson(data)) as Record<string, unknown>,
      sourcemaps: ctx.sourcemaps ?? false,
    };
  });

  return artifact;
}

/**
 * Remove files inside outDir that are not part of the current emission set.
 * Directories that become empty are pruned.
 */
async function cleanStale(outDir: string, keep: ReadonlySet<string>): Promise<void> {
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        const remaining = await readdir(abs).catch(() => ['.']);
        if (remaining.length === 0) await rm(abs, { recursive: true, force: true });
      } else {
        const rel = relative(outDir, abs).split(sep).join('/');
        if (!keep.has(rel)) await rm(abs, { force: true });
      }
    }
  };
  await walk(outDir);
}
