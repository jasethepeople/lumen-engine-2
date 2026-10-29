/**
 * @lumen/app-marketplace — install/update flows (registry level, no UI).
 *
 * install() validates a catalog entry's metadata (semver fields, entryConfig
 * via parseConfig from @lumen/config) and composes a specialization
 * descriptor into a registry through the createExtendedRegistry() seam from
 * @lumen/templates — createDefaultRegistry() and the frozen TemplateKind
 * enum in @lumen/contracts are never touched.
 *
 * InstalledTemplatesStore tracks what was installed; checkUpdates() compares
 * installed versions against catalog versions with a locally implemented
 * semver compare (no dependency).
 */

import { parseConfig } from '@lumen/config';
import { createExtendedRegistry, type TemplateRegistry } from '@lumen/templates';
import type { TemplateDescriptor } from '@lumen/contracts';
import type { TemplateCatalog } from './catalog.js';
import { isSemver, type TemplateMeta } from './meta.js';

/** One installed template record. */
export interface InstalledTemplate {
  templateId: string;
  /** Installed template version (semver). */
  version: string;
  /** Epoch milliseconds when the install was recorded. */
  installedAt: number;
}

/** Persistence abstraction for installed templates. */
export interface InstalledTemplatesStore {
  get(templateId: string): InstalledTemplate | undefined;
  set(record: InstalledTemplate): void;
  remove(templateId: string): void;
  list(): InstalledTemplate[];
}

/** In-memory InstalledTemplatesStore (default; process-lifetime). */
export class MemoryInstalledTemplatesStore implements InstalledTemplatesStore {
  private readonly records = new Map<string, InstalledTemplate>();

  get(templateId: string): InstalledTemplate | undefined {
    const r = this.records.get(templateId);
    return r === undefined ? undefined : { ...r };
  }

  set(record: InstalledTemplate): void {
    this.records.set(record.templateId, { ...record });
  }

  remove(templateId: string): void {
    this.records.delete(templateId);
  }

  list(): InstalledTemplate[] {
    return [...this.records.values()]
      .map((r) => ({ ...r }))
      .sort((a, b) => (a.templateId < b.templateId ? -1 : a.templateId > b.templateId ? 1 : 0));
  }
}

/** Minimal Storage shape (subset of the DOM Storage interface). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = 'lumen.marketplace.installed.v1';

/** LocalStorage-backed InstalledTemplatesStore (browser persistence). */
export class LocalStorageInstalledTemplatesStore implements InstalledTemplatesStore {
  constructor(private readonly storage: StorageLike = (globalThis as { localStorage?: StorageLike }).localStorage as StorageLike) {
    if (!this.storage) {
      throw new Error('LocalStorageInstalledTemplatesStore: no localStorage available in this environment');
    }
  }

  private readAll(): Map<string, InstalledTemplate> {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw === null) return new Map();
    try {
      const parsed = JSON.parse(raw) as InstalledTemplate[];
      return new Map(parsed.map((r) => [r.templateId, r]));
    } catch {
      return new Map();
    }
  }

  private writeAll(records: Map<string, InstalledTemplate>): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify([...records.values()]));
  }

  get(templateId: string): InstalledTemplate | undefined {
    return this.readAll().get(templateId);
  }

  set(record: InstalledTemplate): void {
    const all = this.readAll();
    all.set(record.templateId, { ...record });
    this.writeAll(all);
  }

  remove(templateId: string): void {
    const all = this.readAll();
    all.delete(templateId);
    this.writeAll(all);
  }

  list(): InstalledTemplate[] {
    return [...this.readAll().values()].sort((a, b) =>
      a.templateId < b.templateId ? -1 : a.templateId > b.templateId ? 1 : 0,
    );
  }
}

/**
 * Compare two semver strings: negative when a < b, 0 when equal, positive
 * when a > b. Pre-release tags order before the plain release of the same
 * triple; build metadata is ignored. Implemented locally (no dependency).
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number, number, number, string | undefined] => {
    const [core, ...rest] = v.split('+');
    const [main, pre] = core.split('-');
    const parts = main.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`Invalid semver: '${v}'`);
    }
    void rest;
    return [parts[0], parts[1], parts[2], pre];
  };
  const [aMaj, aMin, aPat, aPre] = parse(a);
  const [bMaj, bMin, bPat, bPre] = parse(b);
  for (const [x, y] of [
    [aMaj, bMaj],
    [aMin, bMin],
    [aPat, bPat],
  ] as const) {
    if (x !== y) return x - y;
  }
  if (aPre === bPre) return 0;
  if (aPre === undefined) return 1;
  if (bPre === undefined) return -1;
  return aPre < bPre ? -1 : 1;
}

/** A catalog template newer than the installed version. */
export interface TemplateUpdate {
  templateId: string;
  installedVersion: string;
  availableVersion: string;
}

/** Validation errors raised before install (never partial installs). */
export class TemplateValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = 'TemplateValidationError';
  }
}

/** Validate marketplace metadata; returns a list of issues (empty = valid). */
export function validateTemplateMeta(meta: TemplateMeta): string[] {
  const issues: string[] = [];
  if (meta.id.trim() === '') issues.push('id must be non-empty');
  if (meta.name.trim() === '') issues.push('name must be non-empty');
  if (!isSemver(meta.version)) issues.push(`version '${meta.version}' is not semver`);
  if (!isSemver(meta.engineMinVersion)) {
    issues.push(`engineMinVersion '${meta.engineMinVersion}' is not semver`);
  }
  if (meta.categories.length === 0) issues.push('categories must contain at least one category');
  const parsed = parseConfig(meta.entryConfig);
  if (!parsed.ok) {
    for (const err of parsed.errors) {
      issues.push(`entryConfig ${err.path}: ${err.message}`);
    }
  }
  return issues;
}

/** Result of install(): a registry ready for createLumenApp. */
export interface InstallResult {
  registry: TemplateRegistry;
  templateId: string;
}

/**
 * Marketplace facade: install and update flows over a loaded catalog plus an
 * InstalledTemplatesStore. Framework-free; a UI layer binds to this later.
 */
export class Marketplace {
  constructor(
    private readonly catalog: TemplateCatalog,
    private readonly store: InstalledTemplatesStore = new MemoryInstalledTemplatesStore(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The underlying catalog. */
  get templates(): TemplateCatalog {
    return this.catalog;
  }

  /** The underlying installed-templates store. */
  get installed(): InstalledTemplatesStore {
    return this.store;
  }

  /**
   * Install a template: validates its metadata, then composes a
   * specialization descriptor for the template into a registry created via
   * the createExtendedRegistry() seam (or into the caller-provided registry),
   * records the install, and returns { registry, templateId } ready for
   * createLumenApp.
   *
   * Because TemplateKind is frozen and registries key descriptors by kind,
   * installing a template replaces the descriptor for its kind in the target
   * registry — the same specialization mechanism createExtendedRegistry()
   * itself uses.
   */
  install(templateId: string, registry: TemplateRegistry = createExtendedRegistry()): InstallResult {
    const meta = this.catalog.getById(templateId);
    if (meta === undefined) {
      throw new TemplateValidationError(`Unknown template '${templateId}'`, [
        `no catalog entry with id '${templateId}'`,
      ]);
    }
    const issues = validateTemplateMeta(meta);
    if (issues.length > 0) {
      throw new TemplateValidationError(
        `Template '${templateId}' failed validation: ${issues.join('; ')}`,
        issues,
      );
    }
    // The specialization seam: start from the extended registry's descriptor
    // for this kind (already a specialization for the built-in kinds), then
    // stamp it with the marketplace template's identity/version and register
    // it under the same frozen kind.
    const base = createExtendedRegistry().require(meta.templateKind);
    const specialization: TemplateDescriptor = { ...base, version: meta.version };
    registry.register(specialization);
    this.store.set({ templateId, version: meta.version, installedAt: this.now() });
    return { registry, templateId };
  }

  /** Catalog templates newer than their installed versions (sorted by id). */
  checkUpdates(): TemplateUpdate[] {
    const updates: TemplateUpdate[] = [];
    for (const record of this.store.list()) {
      const meta = this.catalog.getById(record.templateId);
      if (meta === undefined) continue;
      if (compareSemver(meta.version, record.version) > 0) {
        updates.push({
          templateId: record.templateId,
          installedVersion: record.version,
          availableVersion: meta.version,
        });
      }
    }
    return updates;
  }
}
