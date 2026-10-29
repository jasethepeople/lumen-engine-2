/**
 * @lumen/contracts — build / export domain.
 * Build artifacts, size budgets, and budget reports produced by the export pipeline.
 */

import type { CodegenTarget } from './codegen.js';

/** Role of a file within a build artifact. */
export type ArtifactFileRole = 'entry' | 'chunk' | 'asset' | 'ssr' | 'worker';

/** A single emitted file with size and integrity metadata. */
export interface ArtifactFile {
  /** Output-relative path (includes content hash for hashed files). */
  path: string;
  /** Size in bytes on disk. */
  bytes: number;
  /** Gzipped size in bytes. */
  gzipBytes: number;
  /** Content hash (hex). */
  hash: string;
  /** Role within the artifact. */
  role: ArtifactFileRole;
}

/** Budget metrics checked by the build system. */
export type BudgetMetric = 'js-gz' | 'css-gz' | 'critical-assets' | 'first-frame-ms' | 'lighthouse-a11y';

/** A single size/performance budget declaration. */
export interface SizeBudget {
  /** Metric being budgeted. */
  metric: BudgetMetric;
  /** Threshold value (bytes, milliseconds, or score depending on metric). */
  budget: number;
}

/** Outcome of one budget check. */
export interface BudgetCheck {
  /** Metric checked. */
  metric: BudgetMetric;
  /** Configured threshold. */
  budget: number;
  /** Measured value. */
  actual: number;
  /** Change vs. the stored baseline, when one exists. */
  deltaFromBaseline?: number;
}

/** Aggregate budget gate result for one artifact (emitted as PR-comment JSON in CI). */
export interface BuildBudgetReport {
  /** True when every check is within budget. */
  passed: boolean;
  /** Individual check outcomes. */
  checks: BudgetCheck[];
}

/** A complete emitted output for one target. */
export interface BuildArtifact {
  /** Target this artifact was built for. */
  target: CodegenTarget['target'];
  /** Output directory. */
  outDir: string;
  /** Primary entry file (html | js | json depending on target). */
  entry: string;
  /** All emitted files. */
  files: ArtifactFile[];
  /** Budget gate result. */
  budgets: BuildBudgetReport;
  /** Free-form build report (timings, cache stats, migration notes) for logs/CI. */
  report: Record<string, unknown>;
  /** Whether sourcemaps were emitted. */
  sourcemaps: boolean;
}

/** Options for one build invocation. */
export interface BuildOptions {
  /** Targets to emit in this invocation. */
  targets: CodegenTarget[];
  /** Output root directory. */
  outDir: string;
  /** Emit sourcemaps. */
  sourcemaps?: boolean;
  /** Fail the build when any budget check fails (CI mode). */
  strictBudgets?: boolean;
  /** Content-addressed cache directory; omit to disable caching. */
  cacheDir?: string;
  /** Environment marker, e.g. 'ci' | 'local'. */
  environment?: string;
}
