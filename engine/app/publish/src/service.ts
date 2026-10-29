/**
 * @lumen/app-publish — PublishService.
 *
 * Orchestrates publish: StaticExporter → budget gate (BudgetExceededError on
 * violation) → VercelClient upload → PublishRecord in a PublishHistoryStore
 * (Memory + LocalStorage adapters). Each publish keeps a full bundle snapshot
 * (capped per project) so rollback() can redeploy the exact prior bundle and
 * flip record statuses (old → 'rolled-back', new → 'live').
 *
 * Entitlement hook: an optional gate { assertCan('publish.vercel') } is
 * invoked before every publish/rollback. Default: allow (integration with
 * @lumen/app-entitlements lands later — no dependency here yet).
 */

import type { SizeBudget } from '@lumen/contracts';

import {
  BudgetExceededError,
  StaticExporter,
  type PublishableProject,
  type StaticBundle,
} from './exporter.js';
import type { VercelClient } from './vercel.js';

/** One publish event in the history. */
export interface PublishRecord {
  id: string;
  projectId: string;
  deploymentId: string;
  url: string;
  configHash: string;
  publishedAt: number;
  status: 'live' | 'rolled-back';
  /** Deployment target kind (only 'vercel-mock' today). */
  target: 'vercel-mock';
}

/** Snapshot of a published bundle, kept for rollback. */
export interface BundleSnapshot {
  publishRecordId: string;
  files: Record<string, string>;
}

/** Persistence for publish records + bundle snapshots. */
export interface PublishHistoryStore {
  listRecords(projectId: string): PublishRecord[];
  addRecord(record: PublishRecord): void;
  updateRecord(record: PublishRecord): void;
  getRecord(projectId: string, recordId: string): PublishRecord | undefined;
  saveSnapshot(projectId: string, snapshot: BundleSnapshot): void;
  getSnapshot(publishRecordId: string): BundleSnapshot | undefined;
}

/** Max bundle snapshots retained per project. */
export const SNAPSHOT_CAP = 10;

/** In-memory history store (default). Enforces the snapshot cap. */
export class MemoryPublishHistoryStore implements PublishHistoryStore {
  #records = new Map<string, PublishRecord[]>(); // projectId → records (oldest first)
  #snapshots = new Map<string, BundleSnapshot[]>(); // projectId → snapshots (oldest first)

  listRecords(projectId: string): PublishRecord[] {
    return (this.#records.get(projectId) ?? []).map((r) => ({ ...r }));
  }

  addRecord(record: PublishRecord): void {
    const list = this.#records.get(record.projectId) ?? [];
    list.push({ ...record });
    this.#records.set(record.projectId, list);
  }

  updateRecord(record: PublishRecord): void {
    const list = this.#records.get(record.projectId) ?? [];
    const idx = list.findIndex((r) => r.id === record.id);
    if (idx === -1) throw new Error(`history: record ${record.id} not found for ${record.projectId}`);
    list[idx] = { ...record };
  }

  getRecord(projectId: string, recordId: string): PublishRecord | undefined {
    const found = (this.#records.get(projectId) ?? []).find((r) => r.id === recordId);
    return found ? { ...found } : undefined;
  }

  saveSnapshot(projectId: string, snapshot: BundleSnapshot): void {
    const list = this.#snapshots.get(projectId) ?? [];
    list.push(snapshot);
    while (list.length > SNAPSHOT_CAP) list.shift(); // prune oldest
    this.#snapshots.set(projectId, list);
  }

  getSnapshot(publishRecordId: string): BundleSnapshot | undefined {
    for (const list of this.#snapshots.values()) {
      const found = list.find((s) => s.publishRecordId === publishRecordId);
      if (found) return { ...found, files: { ...found.files } };
    }
    return undefined;
  }
}

export const LOCALSTORAGE_HISTORY_KEY = 'lumen.publish.history.v1';

interface HistoryPayload {
  records: Record<string, PublishRecord[]>;
  snapshots: Record<string, BundleSnapshot[]>;
}

/** LocalStorage-backed history store (browser); throws under Node when used. */
export class LocalStoragePublishHistoryStore implements PublishHistoryStore {
  #key: string;

  constructor(key: string = LOCALSTORAGE_HISTORY_KEY) {
    this.#key = key;
  }

  #storage(): Storage {
    if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
      throw new Error('LocalStoragePublishHistoryStore: localStorage unavailable (non-browser)');
    }
    return globalThis.localStorage;
  }

  #read(): HistoryPayload {
    const raw = this.#storage().getItem(this.#key);
    if (!raw) return { records: {}, snapshots: {} };
    const parsed = JSON.parse(raw) as Partial<HistoryPayload>;
    return { records: parsed.records ?? {}, snapshots: parsed.snapshots ?? {} };
  }

  #write(payload: HistoryPayload): void {
    this.#storage().setItem(this.#key, JSON.stringify(payload));
  }

  listRecords(projectId: string): PublishRecord[] {
    return [...(this.#read().records[projectId] ?? [])];
  }

  addRecord(record: PublishRecord): void {
    const payload = this.#read();
    (payload.records[record.projectId] ??= []).push(record);
    this.#write(payload);
  }

  updateRecord(record: PublishRecord): void {
    const payload = this.#read();
    const list = payload.records[record.projectId] ?? [];
    const idx = list.findIndex((r) => r.id === record.id);
    if (idx === -1) throw new Error(`history: record ${record.id} not found for ${record.projectId}`);
    list[idx] = record;
    this.#write(payload);
  }

  getRecord(projectId: string, recordId: string): PublishRecord | undefined {
    return (this.#read().records[projectId] ?? []).find((r) => r.id === recordId);
  }

  saveSnapshot(projectId: string, snapshot: BundleSnapshot): void {
    const payload = this.#read();
    const list = (payload.snapshots[projectId] ??= []);
    list.push(snapshot);
    while (list.length > SNAPSHOT_CAP) list.shift();
    this.#write(payload);
  }

  getSnapshot(publishRecordId: string): BundleSnapshot | undefined {
    for (const list of Object.values(this.#read().snapshots)) {
      const found = list.find((s) => s.publishRecordId === publishRecordId);
      if (found) return found;
    }
    return undefined;
  }
}

/** Optional entitlement gate; default allows. */
export interface PublishGate {
  assertCan(key: 'publish.vercel'): void;
}

export interface PublishOptions {
  target?: 'vercel-mock';
  /** Budgets enforced on publish; defaults to @lumen/build DEFAULT_BUDGETS. */
  budgets?: readonly SizeBudget[];
}

export interface PublishResult {
  record: PublishRecord;
  bundle: StaticBundle;
}

export interface PublishServiceOptions {
  exporter?: StaticExporter;
  vercel: VercelClient;
  history?: PublishHistoryStore;
  gate?: PublishGate;
  clock?: () => number;
  nextId?: () => string;
}

function projectIdOf(project: PublishableProject): string {
  return project.id;
}

function projectNameOf(project: PublishableProject): string {
  if ('config' in project) return project.name;
  return project.meta?.title ?? project.id;
}

export class PublishService {
  readonly #exporter: StaticExporter;
  readonly #vercel: VercelClient;
  readonly #history: PublishHistoryStore;
  readonly #gate: PublishGate | undefined;
  readonly #clock: () => number;
  readonly #nextId: () => string;

  constructor(options: PublishServiceOptions) {
    this.#exporter = options.exporter ?? new StaticExporter();
    this.#vercel = options.vercel;
    this.#history = options.history ?? new MemoryPublishHistoryStore();
    this.#gate = options.gate;
    this.#clock = options.clock ?? (() => Date.now());
    let counter = 0;
    this.#nextId = options.nextId ?? (() => `pub_${(++counter).toString(36).padStart(6, '0')}`);
  }

  /**
   * Export + budget-gate + deploy + record. Throws BudgetExceededError when
   * the bundle violates its budgets (nothing is deployed or recorded).
   */
  async publish(project: PublishableProject, options: PublishOptions = {}): Promise<PublishResult> {
    const target = options.target ?? 'vercel-mock';
    if (target !== 'vercel-mock') throw new Error(`publish: unknown target '${String(target)}'`);
    this.#gate?.assertCan('publish.vercel');

    const bundle = await this.#exporter.export(project, { budgets: options.budgets });
    if (!bundle.budgets.passed) throw new BudgetExceededError(bundle.budgets);

    const projectId = projectIdOf(project);
    const deployment = await this.#vercel.createDeployment({
      name: projectNameOf(project),
      files: [...bundle.files].map(([path, content]) => ({ path, content })),
    });

    const record: PublishRecord = {
      id: this.#nextId(),
      projectId,
      deploymentId: deployment.deploymentId,
      url: deployment.url,
      configHash: bundle.configHash,
      publishedAt: this.#clock(),
      status: 'live',
      target,
    };
    this.#history.addRecord(record);
    this.#history.saveSnapshot(projectId, {
      publishRecordId: record.id,
      files: Object.fromEntries(
        [...bundle.files].map(([p, c]) => [p, typeof c === 'string' ? c : Buffer.from(c).toString('utf8')]),
      ),
    });
    return { record, bundle };
  }

  /** Publish history for a project, oldest first. */
  listHistory(projectId: string): PublishRecord[] {
    return this.#history.listRecords(projectId);
  }

  /**
   * Roll back to a previous publish: redeploy its recorded bundle snapshot,
   * mark the old record 'rolled-back' and record a new 'live' record with
   * the restored configHash.
   */
  async rollback(projectId: string, publishRecordId: string): Promise<PublishRecord> {
    this.#gate?.assertCan('publish.vercel');

    const old = this.#history.getRecord(projectId, publishRecordId);
    if (!old) throw new Error(`rollback: no publish record ${publishRecordId} for ${projectId}`);
    const snapshot = this.#history.getSnapshot(publishRecordId);
    if (!snapshot) {
      throw new Error(`rollback: bundle snapshot for ${publishRecordId} was pruned or missing`);
    }

    const deployment = await this.#vercel.createDeployment({
      name: projectId,
      files: Object.entries(snapshot.files).map(([path, content]) => ({ path, content })),
    });

    this.#history.updateRecord({ ...old, status: 'rolled-back' });
    const record: PublishRecord = {
      id: this.#nextId(),
      projectId,
      deploymentId: deployment.deploymentId,
      url: deployment.url,
      configHash: old.configHash,
      publishedAt: this.#clock(),
      status: 'live',
      target: old.target,
    };
    this.#history.addRecord(record);
    this.#history.saveSnapshot(projectId, {
      publishRecordId: record.id,
      files: { ...snapshot.files },
    });
    return record;
  }
}
