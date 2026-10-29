/**
 * @lumen/build — size budget enforcement.
 *
 * Gzip sizes are measured with node:zlib (gzipSync, level 9) — the same
 * encoding CDNs apply — so measurements are deterministic and offline.
 *
 * Measurable metrics:
 *  - 'js-gz'           sum of gzipBytes across all *.js/*.mjs files
 *  - 'css-gz'          sum of gzipBytes across all *.css files
 *  - 'critical-assets' raw bytes across asset-role files
 * Runtime metrics ('first-frame-ms', 'lighthouse-a11y') cannot be measured by
 * the file pipeline; they are checked only when supplied via `measured`,
 * otherwise they are reported as skipped warnings.
 *
 * Each budget gets a status: 'pass' (within budget), 'warn' (over budget but
 * within the warn tolerance, default +10%), or 'fail' (beyond tolerance).
 * The aggregate BuildBudgetReport.passed is true only when nothing fails.
 */

import { gzipSync } from 'node:zlib';

import type {
  ArtifactFile,
  BudgetCheck,
  BudgetMetric,
  BuildBudgetReport,
  SizeBudget,
} from '@lumen/contracts';

/** Architecture budgets (§4 of the architecture doc), in bytes. */
export const DEFAULT_BUDGETS: readonly SizeBudget[] = [
  /** JS ≤ 170 KB gz (cinematic SPA / storytelling default). */
  { metric: 'js-gz', budget: 170 * 1024 },
  /** CSS keeps a conservative 40 KB gz ceiling. */
  { metric: 'css-gz', budget: 40 * 1024 },
  /** Critical assets ≤ 1.2 MB on first paint. */
  { metric: 'critical-assets', budget: 1228800 },
];

/** Per-budget outcome status. */
export type BudgetStatus = 'pass' | 'warn' | 'fail' | 'skipped';

/** A BudgetCheck extended with the pipeline's tri-state outcome. */
export interface BudgetOutcome extends BudgetCheck {
  status: BudgetStatus;
}

/** Result of evaluating budgets against an artifact's files. */
export interface BudgetEvaluation {
  report: BuildBudgetReport;
  outcomes: BudgetOutcome[];
  /** Human-readable notes, e.g. skipped runtime metrics. */
  notes: string[];
}

/** Gzip size (bytes) of a UTF-8 string or byte buffer, at level 9. */
export function gzipSize(content: string | Uint8Array): number {
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return gzipSync(data, { level: 9 }).length;
}

const JS_RE = /\.[cm]?js$/i;
const CSS_RE = /\.css$/i;

/** Measure a metric against the emitted file set. */
export function measureMetric(metric: BudgetMetric, files: readonly ArtifactFile[]): number | null {
  switch (metric) {
    case 'js-gz':
      return files.filter((f) => JS_RE.test(f.path)).reduce((sum, f) => sum + f.gzipBytes, 0);
    case 'css-gz':
      return files.filter((f) => CSS_RE.test(f.path)).reduce((sum, f) => sum + f.gzipBytes, 0);
    case 'critical-assets':
      return files.filter((f) => f.role === 'asset').reduce((sum, f) => sum + f.bytes, 0);
    default:
      return null; // runtime metrics are not file-measurable
  }
}

export interface CheckBudgetsOptions {
  /**
   * Fractional headroom above a budget that still counts as 'warn' instead of
   * 'fail'. Default 0.1 (i.e. up to 110% of the budget warns, beyond fails).
   */
  warnTolerance?: number;
  /**
   * Externally measured values for runtime metrics ('first-frame-ms',
   * 'lighthouse-a11y'). Metrics not present here are reported as skipped.
   */
  measured?: Partial<Record<BudgetMetric, number>>;
}

/** Evaluate budgets against an emitted file set. */
export function checkBudgets(
  files: readonly ArtifactFile[],
  budgets: readonly SizeBudget[] = DEFAULT_BUDGETS,
  options: CheckBudgetsOptions = {},
): BudgetEvaluation {
  const warnTolerance = options.warnTolerance ?? 0.1;
  const outcomes: BudgetOutcome[] = [];
  const notes: string[] = [];

  for (const { metric, budget } of budgets) {
    const external = options.measured?.[metric];
    const measured = external ?? measureMetric(metric, files);
    if (measured === null || measured === undefined) {
      outcomes.push({ metric, budget, actual: 0, status: 'skipped' });
      notes.push(
        `Budget '${metric}' skipped: not measurable from emitted files; ` +
          'supply a measured value (e.g. from a Lighthouse run) to enforce it.',
      );
      continue;
    }
    // 'lighthouse-a11y' is a score: higher is better; all other metrics are
    // quantities where lower is better.
    const status: BudgetStatus =
      metric === 'lighthouse-a11y'
        ? measured >= budget
          ? 'pass'
          : measured >= budget * (1 - warnTolerance)
            ? 'warn'
            : 'fail'
        : measured <= budget
          ? 'pass'
          : measured <= budget * (1 + warnTolerance)
            ? 'warn'
            : 'fail';
    outcomes.push({ metric, budget, actual: measured, status });
  }

  const checks: BudgetCheck[] = outcomes.map(({ metric, budget, actual, deltaFromBaseline }) => ({
    metric,
    budget,
    actual,
    ...(deltaFromBaseline !== undefined ? { deltaFromBaseline } : {}),
  }));

  return {
    report: { passed: outcomes.every((o) => o.status !== 'fail'), checks },
    outcomes,
    notes,
  };
}
