/**
 * @lumen/backend-supabase — public API.
 *
 * Hosted Supabase bindings for the Lumen Builder. Zero runtime deps: bring
 * any structurally-compatible client (SupabaseClientLike). All table,
 * column, bucket and channel names follow backend/SCHEMA.md.
 */
export type {
  SupabaseBucketLike,
  SupabaseChannelLike,
  SupabaseClientLike,
  SupabaseErrorLike,
  SupabaseFunctionsLike,
  SupabaseQueryLike,
  SupabaseResult,
} from './client.js';
export { unwrap, unwrapRows } from './client.js';

export { HostedAuth } from './auth.js';
export type { AuthChangeCallback, AuthCredentials, HostedUser } from './auth.js';

export {
  EXPORT_FORMAT_VERSION,
  HostedProjectStore,
  PROJECT_SCHEMA_VERSION,
} from './projects.js';
export type {
  CreateProjectInput,
  HostedProjectStoreOptions,
  Project,
  ProjectConfig,
  ProjectExportEnvelope,
  ProjectVersion,
  UpdateProjectPatch,
} from './projects.js';

export { HostedAssetQueue, toHostedAsset } from './assets.js';
export type {
  AssetJobEventCallback,
  EnqueueAssetInput,
  HostedAsset,
  HostedAssetJob,
  HostedAssetJobStatus,
  HostedAssetKind,
  HostedAssetQueueOptions,
  HostedAssetStatus,
} from './assets.js';

export { HostedPublishService, toHostedPublish } from './publish.js';
export type {
  HostedPublishRecord,
  HostedPublishResult,
  HostedPublishStatus,
} from './publish.js';

export { HostedCatalog, toTemplateMeta } from './marketplace.js';
export type {
  CreatorUploadInput,
  HostedCatalogOptions,
  HostedPurchase,
  TemplateMeta,
} from './marketplace.js';

export { HostedCollaboration } from './collaboration.js';
export type {
  HostedActivityEntry,
  HostedCollaborationOptions,
  HostedInvitation,
  HostedMember,
  HostedMergeSuggestion,
  InvitationStatus,
  PresenceState,
  Role,
} from './collaboration.js';

export { HostedDashboard } from './dashboard.js';
export type {
  HostedAnalyticsStats,
  HostedDashboardOverview,
  HostedDashboardProject,
} from './dashboard.js';

export { HANDLE_PATTERN, HandleTakenError, HostedCommunity } from './community.js';
export type {
  HostedComment,
  HostedCommentNode,
  HostedCommunityOptions,
  HostedProfile,
  HostedRemix,
} from './community.js';

export { HostedBilling } from './billing.js';
export type {
  HostedBillingOptions,
  HostedPayout,
  HostedPlanId,
  HostedRevenueEntry,
  HostedSubscription,
} from './billing.js';

export { HostedEntitlementResolver } from './entitlements.js';
export type {
  HostedEntitlementResolverOptions,
  ResolvedEntitlements,
} from './entitlements.js';

export { HostedTelemetry } from './telemetry.js';
export type { HostedTelemetryOptions, HostedTelemetryProps } from './telemetry.js';

// AI stays local-only: re-exported local provider seam.
export * as ai from './ai.js';

export {
  createBackend,
  createLumenBackend,
  createOfflineBackend,
  OfflineAssetQueue,
  OfflineAuth,
} from './facade.js';
export type {
  Backend,
  BackendEnv,
  CreateLumenBackendOptions,
  LumenBackend,
  OfflineBackend,
} from './facade.js';
