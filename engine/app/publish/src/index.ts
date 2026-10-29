/**
 * @lumen/app-publish — public API.
 *
 * StaticExporter (config → static bundle, in-memory, pluggable sink),
 * MockVercelClient (zero-network deploy lifecycle), PublishService
 * (budget-gated publish, history, rollback), entitlement gate hook.
 */

export {
  StaticExporter,
  MemorySink,
  NodeFsSink,
  BudgetExceededError,
  InvalidConfigError,
  configHashOf,
  type BudgetViolation,
  type ExportSink,
  type PublishableProject,
  type StaticBundle,
  type StaticExportOptions,
} from './exporter.js';
export {
  MockVercelClient,
  MemoryVercelStore,
  LocalStorageVercelStore,
  LOCALSTORAGE_VERCEL_KEY,
  deploymentSlug,
  type CreateDeploymentInput,
  type MockVercelClientOptions,
  type VercelClient,
  type VercelDeployment,
  type VercelDeploymentStore,
  type VercelFile,
} from './vercel.js';
export {
  PublishService,
  MemoryPublishHistoryStore,
  LocalStoragePublishHistoryStore,
  LOCALSTORAGE_HISTORY_KEY,
  SNAPSHOT_CAP,
  type BundleSnapshot,
  type PublishGate,
  type PublishHistoryStore,
  type PublishOptions,
  type PublishRecord,
  type PublishResult,
  type PublishServiceOptions,
} from './service.js';
