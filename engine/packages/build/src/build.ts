/**
 * @lumen/build — public facade.
 *
 * `build(config, generate, options?)` runs the pipeline for a single target
 * and resolves with the emitted BuildArtifact. `buildAll` runs several
 * targets sequentially (each with its own per-target outDir subdirectory).
 */

import type {
  BuildArtifact,
  BuildOptions,
  CodegenTarget,
  SizeBudget,
} from '@lumen/contracts';

import { runPipeline, type GenerateFn, type MinifyHook, type PipelineContext } from './pipeline.js';
import type { CheckBudgetsOptions } from './budgets.js';

/** Configuration for one build invocation. */
export interface BuildConfig {
  /** Target descriptor (flavor, minify, ssr, moduleFormat). */
  target: CodegenTarget;
  /** Output directory for this target's artifact. */
  outDir: string;
  /** Pluggable minify hooks (optimize phase). */
  minifyHooks?: readonly MinifyHook[];
  /** Budgets to enforce; defaults to the architecture budgets. */
  budgets?: readonly SizeBudget[];
  /** Emit sourcemaps flag passed through to codegen. */
  sourcemaps?: boolean;
  /** Fail the build when any budget check fails (CI mode). */
  strictBudgets?: boolean;
  /** Externally measured runtime metrics ('first-frame-ms', 'lighthouse-a11y'). */
  measuredMetrics?: CheckBudgetsOptions['measured'];
  /** Environment marker, e.g. 'ci' | 'local'. */
  environment?: string;
  /** Remove stale files from previous builds (default true). */
  clean?: boolean;
  /** Vendor @lumen/* runtime packages into <outDir>/vendor (default: on for target 'static'). */
  vendorRuntime?: boolean;
  /** Optional sink for the human-readable report. */
  onReport?: (text: string) => void;
}

/** Optional overrides applied over the config (CLI/CI call sites). */
export interface BuildOverrides {
  strictBudgets?: boolean;
  sourcemaps?: boolean;
  environment?: string;
}

/**
 * Build one target. `generate` is injected by the caller — the Integration
 * layer passes @lumen/codegen's `generate()` here; @lumen/build itself never
 * imports codegen beyond the shared contracts types.
 */
export async function build(
  config: BuildConfig,
  generate: GenerateFn,
  options: BuildOverrides = {},
): Promise<BuildArtifact> {
  const ctx: PipelineContext = {
    outDir: config.outDir,
    minifyHooks: config.minifyHooks,
    budgets: config.budgets,
    measuredMetrics: config.measuredMetrics,
    clean: config.clean,
    vendorRuntime: config.vendorRuntime,
    onReport: config.onReport,
    sourcemaps: options.sourcemaps ?? config.sourcemaps ?? false,
    strictBudgets: options.strictBudgets ?? config.strictBudgets ?? false,
    environment: options.environment ?? config.environment ?? 'local',
  };
  return runPipeline(config.target, generate, ctx);
}

/**
 * Build every target listed in a BuildOptions-shaped invocation. Each target
 * gets its own subdirectory under `options.outDir` named after the target
 * kind. Resolves with one BuildArtifact per target, in input order.
 */
export async function buildAll(
  options: BuildOptions & {
    vendorRuntime?: boolean;
    budgets?: readonly SizeBudget[];
    minifyHooks?: readonly MinifyHook[];
    measuredMetrics?: CheckBudgetsOptions['measured'];
    onReport?: (text: string) => void;
  },
  generate: GenerateFn,
): Promise<BuildArtifact[]> {
  const artifacts: BuildArtifact[] = [];
  for (const target of options.targets) {
    artifacts.push(
      await build(
        {
          target,
          outDir: `${options.outDir.replace(/\/+$/, '')}/${target.target}`,
          vendorRuntime: options.vendorRuntime,
          budgets: options.budgets,
          minifyHooks: options.minifyHooks,
          measuredMetrics: options.measuredMetrics,
          onReport: options.onReport,
        },
        generate,
        {
          sourcemaps: options.sourcemaps,
          strictBudgets: options.strictBudgets,
          environment: options.environment,
        },
      ),
    );
  }
  return artifacts;
}
