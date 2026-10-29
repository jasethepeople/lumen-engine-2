/**
 * @lumen/app-dashboard — public API.
 *
 * DashboardService (project aggregation over ProjectStore + PublishService
 * seams), AnalyticsStore (LOCAL-ONLY, self-reported publish-view telemetry —
 * never real traffic), PreviewService (in-memory preview-before-publish,
 * no deploys, no history pollution) and mock share links (zero network).
 */

export {
  DashboardService,
  type DashboardOverview,
  type DashboardProject,
  type DashboardProjectStore,
  type DashboardPublishService,
  type DashboardServiceOptions,
} from './service.js';
export {
  AnalyticsStore,
  MemoryAnalyticsStorage,
  LocalStorageAnalyticsStorage,
  LOCALSTORAGE_ANALYTICS_KEY,
  ANALYTICS_CAP,
  dayKey,
  dayStart,
  type AnalyticsDayBucket,
  type AnalyticsStats,
  type AnalyticsStatsQuery,
  type AnalyticsStorage,
  type AnalyticsStoreOptions,
  type PublishViewEvent,
  type TopProjectEntry,
} from './analytics.js';
export {
  PreviewService,
  DEFAULT_PREVIEW_TTL_MS,
  previewSlug,
  type Preview,
  type PreviewInfo,
  type PreviewProjectStore,
  type PreviewServiceOptions,
  type ShareLink,
} from './preview.js';
