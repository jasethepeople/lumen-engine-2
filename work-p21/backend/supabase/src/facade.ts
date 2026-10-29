/**
 * LumenBackend facade — composes every per-domain hosted binding behind one
 * object so the Builder swaps local ↔ hosted by switching a single factory:
 *
 *   createLumenBackend({client})   — hosted (Supabase-backed)
 *   createOfflineBackend()         — zero-config local (memory adapters)
 *   createBackend(env)             — auto-select on VITE_SUPABASE_* env vars
 */
import { EntitlementService } from '@lumen/app-entitlements';
import { createTelemetryClient } from '@lumen/app-telemetry';
import { MemoryStorage, ProjectStore } from '@lumen/app-projects';
import type { SupabaseClientLike } from './client.js';
import { HostedAuth } from './auth.js';
import { HostedProjectStore } from './projects.js';
import { HostedAssetQueue } from './assets.js';
import { HostedPublishService } from './publish.js';
import { HostedCatalog } from './marketplace.js';
import { HostedCollaboration } from './collaboration.js';
import { HostedDashboard } from './dashboard.js';
import { HostedCommunity } from './community.js';
import { HostedBilling } from './billing.js';
import { HostedEntitlementResolver } from './entitlements.js';
import { HostedTelemetry } from './telemetry.js';
import * as ai from './ai.js';

/** Hosted backend facade. */
export interface LumenBackend {
  auth: HostedAuth;
  projects: HostedProjectStore;
  assets: HostedAssetQueue;
  publish: HostedPublishService;
  marketplace: HostedCatalog;
  collaboration: HostedCollaboration;
  /** Local-only AI seam (identical in hosted and offline modes). */
  ai: typeof ai;
  dashboard: HostedDashboard;
  community: HostedCommunity;
  billing: HostedBilling;
  entitlements: HostedEntitlementResolver;
  telemetry: HostedTelemetry;
  mode: 'hosted';
}

export interface CreateLumenBackendOptions {
  client: SupabaseClientLike;
  /** Shared user-id resolver override (defaults to client.auth.getUser). */
  userId?: () => Promise<string | undefined>;
  telemetry?: { enabled?: boolean };
}

export function createLumenBackend(options: CreateLumenBackendOptions): LumenBackend {
  const { client } = options;
  const shared = options.userId !== undefined ? { userId: options.userId } : {};
  return {
    auth: new HostedAuth(client),
    projects: new HostedProjectStore(client, shared),
    assets: new HostedAssetQueue(client, shared),
    publish: new HostedPublishService(client),
    marketplace: new HostedCatalog(client, shared),
    collaboration: new HostedCollaboration(client, shared),
    ai,
    dashboard: new HostedDashboard(client),
    community: new HostedCommunity(client, shared),
    billing: new HostedBilling(client, shared),
    entitlements: new HostedEntitlementResolver(client, shared),
    telemetry: new HostedTelemetry(client, {
      ...(options.telemetry?.enabled !== undefined
        ? { enabled: options.telemetry.enabled }
        : {}),
      ...shared,
    }),
    mode: 'hosted',
  };
}

// ---------------------------------------------------------------- offline --

/** Minimal offline auth: a single deterministic local user. */
export class OfflineAuth {
  private user: { id: string; email?: string } | null = {
    id: 'offline-user',
    email: 'offline@localhost',
  };

  async signUp(): Promise<{ id: string; email?: string } | null> {
    return this.user;
  }

  async signInWithPassword(): Promise<{ id: string; email?: string } | null> {
    return this.user;
  }

  async signInWithMagicLink(): Promise<void> {}

  async signOut(): Promise<void> {}

  async getUser(): Promise<{ id: string; email?: string } | null> {
    return this.user;
  }

  onAuthChange(): () => void {
    return () => {};
  }
}

/**
 * Offline asset queue: in-memory rows mirroring the hosted shapes; jobs are
 * marked done immediately (no worker in offline mode).
 */
export class OfflineAssetQueue {
  private readonly assets = new Map<string, Record<string, unknown>>();
  private seq = 0;

  async enqueue(input: {
    projectId: string;
    name: string;
    kind: string;
    ops: string[];
  }): Promise<{ asset: Record<string, unknown>; job: Record<string, unknown> }> {
    const id = `offline-asset-${++this.seq}`;
    const asset = {
      id,
      projectId: input.projectId,
      ownerId: 'offline-user',
      name: input.name,
      kind: input.kind,
      status: 'done',
      createdAt: new Date().toISOString(),
    };
    const job = {
      id: `offline-job-${this.seq}`,
      assetId: id,
      ops: input.ops,
      status: 'done',
      progress: 100,
    };
    this.assets.set(id, asset);
    return { asset, job };
  }

  async getAsset(id: string): Promise<Record<string, unknown> | undefined> {
    return this.assets.get(id);
  }

  async listAssets(projectId: string): Promise<Record<string, unknown>[]> {
    return [...this.assets.values()].filter((a) => a['projectId'] === projectId);
  }

  async getManifest(assetId: string): Promise<unknown> {
    return this.assets.get(assetId)?.['manifest'];
  }

  subscribeToJobStatus(): () => void {
    return () => {};
  }
}

/**
 * Offline backend facade — delegates to the local @lumen/app-* packages
 * (memory adapters) so the Builder runs with zero Supabase config.
 */
export interface OfflineBackend {
  auth: OfflineAuth;
  projects: ProjectStore;
  assets: OfflineAssetQueue;
  marketplace: { mode: 'offline' };
  collaboration: { mode: 'offline' };
  ai: typeof ai;
  telemetry: ReturnType<typeof createTelemetryClient>;
  entitlements: EntitlementService;
  mode: 'offline';
}

export function createOfflineBackend(): OfflineBackend {
  return {
    auth: new OfflineAuth(),
    // Local ProjectStore (memory storage) — same method surface as hosted.
    projects: new ProjectStore(new MemoryStorage()),
    assets: new OfflineAssetQueue(),
    marketplace: { mode: 'offline' },
    collaboration: { mode: 'offline' },
    ai,
    // Local telemetry client — opt-in, default OFF, same as hosted.
    telemetry: createTelemetryClient(),
    // Pure gating on the local 'free' plan.
    entitlements: new EntitlementService(() => 'free'),
    mode: 'offline',
  };
}

// ------------------------------------------------------------ auto-select --

export interface BackendEnv {
  VITE_SUPABASE_URL?: string | undefined;
  VITE_SUPABASE_ANON_KEY?: string | undefined;
}

export type Backend = LumenBackend | OfflineBackend;

/**
 * Auto-select: hosted when both VITE_SUPABASE_URL and the anon key are
 * present (a client factory must be supplied to build the client), else
 * offline with zero configuration.
 */
export function createBackend(
  env: BackendEnv,
  hosted?: CreateLumenBackendOptions,
): Backend {
  const hasConfig = Boolean(env.VITE_SUPABASE_URL) && Boolean(env.VITE_SUPABASE_ANON_KEY);
  if (hasConfig && hosted) return createLumenBackend(hosted);
  return createOfflineBackend();
}
