/**
 * Platform service singletons for the Builder UI.
 *
 * Every service here is a REAL package instance wired over browser storage
 * adapters (localStorage where available, in-memory otherwise). No mocks
 * beyond the packages' own offline providers (MockBillingProvider /
 * MockVercelClient are the packages' shipped offline implementations).
 */

import {
  AutosaveManager,
  LocalStorageAdapter,
  MemoryStorage,
  ProjectStore,
} from '@lumen/app-projects';
import {
  LocalStorageSettingsAdapter,
  SettingsStore,
  resolveDeviceClass,
  type DeviceClass,
} from '@lumen/app-settings';
import { LocalStorageSink, createTelemetryClient } from '@lumen/app-telemetry';
import { LocalStorageBillingAdapter, MockBillingProvider } from '@lumen/app-billing';
import { EntitlementService, FREE_PLAN_ID } from '@lumen/app-entitlements';
import {
  BuiltinSource,
  BUILTIN_TEMPLATES,
  LocalStorageInstalledTemplatesStore,
  Marketplace,
  TemplateCatalog,
  getPricedTemplate,
  PRICED_TEMPLATES,
  LocalStoragePurchaseStore,
  MemoryPurchaseStore,
  MockTemplateBillingProvider,
  TemplatePurchases,
  CreatorTemplateService,
  LocalStorageCreatorTemplateStore,
  MemoryCreatorTemplateStore,
  type MarketplaceSource,
} from '@lumen/app-marketplace';
import { canAccessTemplate as _canAccessTemplate, type OwnershipResolver } from '@lumen/app-entitlements';
import { RevenueShareLedger } from '@lumen/app-billing';
import {
  ActivityLog,
  CollaborationService,
  ConflictResolver,
  InvitationService,
  LocalStorageMembershipStore,
  MemoryMembershipStore,
  PresenceTracker,
  type ProjectStoreSeam,
} from '@lumen/app-collaboration';
import {
  AnalyticsStore,
  DashboardService,
  LocalStorageAnalyticsStorage,
  PreviewService,
} from '@lumen/app-dashboard';
import {
  CommentService,
  CommunityShowcase,
  ProfileStore,
  RemixService,
  defaultCommunityStorage,
} from '@lumen/app-community';
import { HeuristicProvider } from '@lumen/app-ai';

// Re-exported so panels import the gating seam from one place.
export { _canAccessTemplate as canAccessTemplate };
import {
  AssetLibrary,
  AssetUploadQueue,
  detectDeviceClass,
} from '@lumen/app-assets';
import {
  LocalStoragePublishHistoryStore,
  LocalStorageVercelStore,
  MockVercelClient,
  PublishService,
} from '@lumen/app-publish';
import { BrowserMediaExecutor } from './browser-executor';

/** Single mock user for the local builder session. */
export const USER_ID = 'local-builder';

const hasLocalStorage = () =>
  typeof globalThis.localStorage !== 'undefined' && LocalStorageAdapter.isAvailable();

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const settingsStore = new SettingsStore({
  storage: new LocalStorageSettingsAdapter(),
});

// ---------------------------------------------------------------------------
// Telemetry (opt-in; default off — nothing is recorded until enabled)
// ---------------------------------------------------------------------------

export const telemetry = createTelemetryClient({
  sink: new LocalStorageSink(),
  enabled: false,
});

// ---------------------------------------------------------------------------
// Billing + entitlements
// ---------------------------------------------------------------------------

export const billing = new MockBillingProvider({
  storage: new LocalStorageBillingAdapter(),
});

/**
 * Cached plan id. EntitlementService's PlanResolver is synchronous while the
 * BillingProvider is async, so the UI refreshes this cache after every
 * billing mutation and on startup; the resolver reads the cache.
 */
let currentPlanId: string = FREE_PLAN_ID;
const planListeners = new Set<(planId: string) => void>();

export function getPlanId(): string {
  return currentPlanId;
}

export function onPlanChange(listener: (planId: string) => void): () => void {
  planListeners.add(listener);
  return () => planListeners.delete(listener);
}

export async function refreshPlan(): Promise<string> {
  const sub = await billing.getSubscription(USER_ID);
  const active = sub.status === 'active' || sub.status === 'trialing';
  currentPlanId = active ? sub.planId : FREE_PLAN_ID;
  planListeners.forEach((l) => l(currentPlanId));
  return currentPlanId;
}

export async function switchPlan(planId: string): Promise<string> {
  if (planId === FREE_PLAN_ID) {
    await billing.cancel(USER_ID);
  } else {
    await billing.checkout(USER_ID, planId);
  }
  return refreshPlan();
}

export const entitlements = new EntitlementService(() => currentPlanId);

// ---------------------------------------------------------------------------
// Projects + autosave
// ---------------------------------------------------------------------------

export const projectStore = new ProjectStore(
  hasLocalStorage() ? new LocalStorageAdapter() : new MemoryStorage(),
);

export const autosave = new AutosaveManager(projectStore, {
  label: 'autosave',
  onError: (err) => console.error('[autosave]', err),
});

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------

export const installedTemplates = new LocalStorageInstalledTemplatesStore();

let marketplaceInstance: Marketplace | null = null;

/**
 * Loads the catalog and returns the Marketplace facade. Delegates to the
 * monetization-aware loader so paid builtins and creator uploads are part of
 * the catalog everywhere the marketplace is used.
 */
export async function getMarketplace(): Promise<Marketplace> {
  return getMarketplaceWithMonetization();
}

// ---------------------------------------------------------------------------
// Assets pipeline
// ---------------------------------------------------------------------------

export function detectCurrentDeviceClass(): DeviceClass {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const detected = detectDeviceClass({
    hardwareConcurrency: nav?.hardwareConcurrency,
    deviceMemory: (nav as { deviceMemory?: number } | undefined)?.deviceMemory,
    userAgent: nav?.userAgent,
    screenWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
  });
  return resolveDeviceClass(settingsStore.get(), detected);
}

export const assetLibrary = new AssetLibrary({
  storage: hasLocalStorage() ? globalThis.localStorage : undefined,
});

export const assetQueue = new AssetUploadQueue({
  executor: new BrowserMediaExecutor(),
});

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export const publishService = new PublishService({
  vercel: new MockVercelClient({
    store: hasLocalStorage() ? new LocalStorageVercelStore() : undefined,
    latencyMs: 400,
  }),
  history: hasLocalStorage() ? new LocalStoragePublishHistoryStore() : undefined,
  gate: entitlements,
});

// Kick off the initial plan resolution.
void refreshPlan();

// ---------------------------------------------------------------------------
// Marketplace monetization (paid templates, purchases, creator uploads)
// ---------------------------------------------------------------------------

export const purchaseStore = hasLocalStorage()
  ? new LocalStoragePurchaseStore()
  : new MemoryPurchaseStore();

export const creatorTemplateStore = hasLocalStorage()
  ? new LocalStorageCreatorTemplateStore()
  : new MemoryCreatorTemplateStore();

export const creatorService = new CreatorTemplateService(creatorTemplateStore);

/** Offline charge provider shipped by the marketplace package itself. */
export const templateBilling = new MockTemplateBillingProvider();

/**
 * Template purchases over the mock provider. The resolver looks up any
 * template the catalog can serve: priced builtins, creator uploads and the
 * builtin catalog entries.
 */
export const templatePurchases = new TemplatePurchases(
  purchaseStore,
  templateBilling,
  () => Date.now(),
  (templateId) => {
    const priced = getPricedTemplate(templateId);
    if (priced) return priced;
    const creator = creatorTemplateStore.get(templateId);
    if (creator) return creator.meta;
    return BUILTIN_TEMPLATES.find((t) => t.id === templateId);
  },
);

/** Synchronous ownership check for canAccessTemplate's OwnershipResolver. */
export const ownsTemplate: OwnershipResolver = (userId, templateId) =>
  templatePurchases.ownsTemplate(userId, templateId);

/** Revenue-share ledger fed by every successful template purchase. */
export const revenueLedger = new RevenueShareLedger();

/**
 * Catalog source exposing the package's PRICED_TEMPLATES (paid builtins) so
 * they show up in search alongside the free catalog.
 */
const pricedSource: MarketplaceSource = {
  id: 'priced',
  fetchIndex: () => Promise.resolve([...PRICED_TEMPLATES]),
};

/** Loads the catalog (builtin ∪ priced ∪ creator uploads) + Marketplace facade. */
export async function getMarketplaceWithMonetization(): Promise<Marketplace> {
  if (!marketplaceInstance) {
    const catalog = await TemplateCatalog.load([
      new BuiltinSource(),
      pricedSource,
      creatorService.source,
    ]);
    marketplaceInstance = new Marketplace(catalog, installedTemplates);
  }
  return marketplaceInstance;
}

/** Reload after a creator upload/edit so new templates appear in search. */
export async function reloadMarketplace(): Promise<Marketplace> {
  marketplaceInstance = null;
  return getMarketplaceWithMonetization();
}

// ---------------------------------------------------------------------------
// Collaboration (team) — local-only package services
// ---------------------------------------------------------------------------

export const membershipStore = hasLocalStorage()
  ? new LocalStorageMembershipStore()
  : new MemoryMembershipStore();

/**
 * ProjectStore is structurally compatible with the collaboration seam, but
 * ProjectRef carries an index signature Project lacks — a one-way narrowing
 * cast, safe because the seam only reads id/config/updatedAt.
 */
const projectSeam = projectStore as unknown as ProjectStoreSeam;

export const collaboration = new CollaborationService(projectSeam, membershipStore);
export const invitations = new InvitationService(membershipStore);
export const presence = new PresenceTracker();
export const activityLog = new ActivityLog();
export const conflictResolver = new ConflictResolver(projectSeam);

// ---------------------------------------------------------------------------
// Dashboard + analytics + previews
// ---------------------------------------------------------------------------

export const analyticsStore = new AnalyticsStore({
  storage: hasLocalStorage() ? new LocalStorageAnalyticsStorage() : undefined,
});

export const dashboardService = new DashboardService({
  projects: projectStore,
  publish: publishService,
});

export const previewService = new PreviewService({ projects: projectStore });

// ---------------------------------------------------------------------------
// Community (profiles, showcase, remix, comments)
// ---------------------------------------------------------------------------

export const communityStorage = defaultCommunityStorage();
export const profileStore = new ProfileStore({ storage: communityStorage });
export const showcase = new CommunityShowcase(profileStore, { storage: communityStorage });
export const remixService = new RemixService(showcase, profileStore, {
  storage: communityStorage,
});
export const commentService = new CommentService({ storage: communityStorage });

// ---------------------------------------------------------------------------
// AI assistant — deterministic heuristic provider shipped by the package
// ---------------------------------------------------------------------------

export const aiProvider = new HeuristicProvider();
