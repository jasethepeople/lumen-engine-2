/**
 * @lumen/build — build/export pipeline producing BuildArtifacts.
 * Public API surface.
 */

export { build, buildAll, type BuildConfig, type BuildOverrides } from './build.js';
export { vendorRuntimePackages, RUNTIME_VENDOR_PACKAGES } from './vendor.js';
export {
  runPipeline,
  hashPlannedFiles,
  type GenerateFn,
  type MinifyHook,
  type PipelineContext,
  type DeployManifest,
} from './pipeline.js';
export {
  contentHash,
  hashedFilename,
  rewriteImportPaths,
  HASH_LENGTH,
} from './hash.js';
export {
  DEFAULT_BUDGETS,
  checkBudgets,
  gzipSize,
  measureMetric,
  type BudgetEvaluation,
  type BudgetOutcome,
  type BudgetStatus,
  type CheckBudgetsOptions,
} from './budgets.js';
export {
  formatReportText,
  formatReportJson,
  type BuildReportData,
  type PhaseTimings,
} from './report.js';
export {
  resolveStrategy,
  isTargetKind,
  type TargetKind,
  type TargetStrategy,
  type PlannedFile,
} from './targets.js';
