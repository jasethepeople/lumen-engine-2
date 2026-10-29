/**
 * @lumen/build — build reporting.
 *
 * Produces both a human-readable text summary (for local logs) and a
 * machine-readable JSON payload (for CI PR comments / dashboards, the
 * `--report=json` mode from the architecture doc).
 */

import type { ArtifactFile, BuildBudgetReport, CodegenWarning } from '@lumen/contracts';

import type { BudgetOutcome } from './budgets.js';

/** Phase timings collected by the pipeline. */
export type PhaseTimings = Record<string, number>;

/** Everything the reporter needs to describe one build. */
export interface BuildReportData {
  target: string;
  outDir: string;
  entry: string;
  files: readonly ArtifactFile[];
  budgets: BuildBudgetReport;
  outcomes: readonly BudgetOutcome[];
  warnings: readonly CodegenWarning[];
  budgetNotes: readonly string[];
  timings: PhaseTimings;
  environment: string;
  sourcemaps: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const STATUS_MARK: Record<BudgetOutcome['status'], string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  skipped: 'SKIP',
};

/** Render a human-readable multi-line build report. */
export function formatReportText(data: BuildReportData): string {
  const lines: string[] = [];
  lines.push(`@lumen/build — target '${data.target}' (${data.environment})`);
  lines.push(`  outDir:    ${data.outDir}`);
  lines.push(`  entry:     ${data.entry}`);
  lines.push(`  sourcemaps: ${data.sourcemaps ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('  Files:');
  const totalBytes = data.files.reduce((sum, f) => sum + f.bytes, 0);
  const totalGzip = data.files.reduce((sum, f) => sum + f.gzipBytes, 0);
  for (const file of data.files) {
    lines.push(
      `    [${file.role.padEnd(5)}] ${file.path}  ` +
        `${formatBytes(file.bytes)} (gz ${formatBytes(file.gzipBytes)})  #${file.hash}`,
    );
  }
  lines.push(`    total: ${formatBytes(totalBytes)} (gz ${formatBytes(totalGzip)})`);
  lines.push('');
  lines.push(`  Budgets: ${data.budgets.passed ? 'PASSED' : 'FAILED'}`);
  for (const outcome of data.outcomes) {
    lines.push(
      `    ${STATUS_MARK[outcome.status]} ${outcome.metric}: ` +
        `${formatBytes(outcome.actual)} / ${formatBytes(outcome.budget)}`,
    );
  }
  for (const note of data.budgetNotes) lines.push(`    note: ${note}`);
  if (data.warnings.length > 0) {
    lines.push('');
    lines.push('  Warnings:');
    for (const warning of data.warnings) {
      lines.push(
        `    [${warning.code}] ${warning.message}${warning.subject ? ` (${warning.subject})` : ''}`,
      );
    }
  }
  lines.push('');
  lines.push('  Timings:');
  for (const [phase, ms] of Object.entries(data.timings)) {
    lines.push(`    ${phase}: ${ms.toFixed(1)} ms`);
  }
  return lines.join('\n');
}

/** Render the machine-readable JSON report (CI / dashboard mode). */
export function formatReportJson(data: BuildReportData): string {
  const payload = {
    target: data.target,
    outDir: data.outDir,
    entry: data.entry,
    environment: data.environment,
    sourcemaps: data.sourcemaps,
    files: data.files.map((f) => ({
      path: f.path,
      bytes: f.bytes,
      gzipBytes: f.gzipBytes,
      hash: f.hash,
      role: f.role,
    })),
    totals: {
      bytes: data.files.reduce((sum, f) => sum + f.bytes, 0),
      gzipBytes: data.files.reduce((sum, f) => sum + f.gzipBytes, 0),
      count: data.files.length,
    },
    budgets: {
      passed: data.budgets.passed,
      checks: data.outcomes.map((o) => ({
        metric: o.metric,
        budget: o.budget,
        actual: o.actual,
        status: o.status,
      })),
      notes: data.budgetNotes,
    },
    warnings: data.warnings,
    timings: data.timings,
  };
  return JSON.stringify(payload, null, 2);
}
