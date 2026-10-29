/**
 * @lumen/app-marketplace — creator templates (Phase 15).
 *
 * CreatorTemplateService lets creators upload their own templates: the
 * entryConfig is validated with parseConfig from @lumen/config and the
 * version fields with isSemver, then stored as a source-backed catalog entry
 * (CreatorSource implements MarketplaceSource over Memory/LocalStorage, so
 * creator entries flow into TemplateCatalog through the existing source seam).
 *
 * Also includes the metadata editor (updateMeta with ownership check +
 * revalidation) and a deterministic, render-free preview generator.
 */

import { parseConfig } from '@lumen/config';
import type { EngineConfig } from '@lumen/contracts';
import type { MarketplaceSource } from './catalog.js';
import { isSemver, makeThumbnail, type TemplateMeta } from './meta.js';

/** A stored creator template: catalog metadata plus its owning author. */
export interface CreatorTemplateRecord {
  authorId: string;
  meta: TemplateMeta;
}

/** Persistence abstraction for creator templates (synchronous). */
export interface CreatorTemplateStore {
  get(templateId: string): CreatorTemplateRecord | undefined;
  set(record: CreatorTemplateRecord): void;
  list(): CreatorTemplateRecord[];
}

/** In-memory CreatorTemplateStore (default; process-lifetime). */
export class MemoryCreatorTemplateStore implements CreatorTemplateStore {
  private readonly records = new Map<string, CreatorTemplateRecord>();

  get(templateId: string): CreatorTemplateRecord | undefined {
    const r = this.records.get(templateId);
    return r === undefined ? undefined : { authorId: r.authorId, meta: { ...r.meta } };
  }

  set(record: CreatorTemplateRecord): void {
    this.records.set(record.meta.id, { authorId: record.authorId, meta: { ...record.meta } });
  }

  list(): CreatorTemplateRecord[] {
    return [...this.records.values()]
      .map((r) => ({ authorId: r.authorId, meta: { ...r.meta } }))
      .sort((a, b) => (a.meta.id < b.meta.id ? -1 : 1));
  }
}

const STORAGE_KEY = 'lumen.marketplace.creator-templates.v1';

/** Minimal Storage shape (subset of the DOM Storage interface). */
export interface CreatorStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** LocalStorage-backed CreatorTemplateStore (browser persistence). */
export class LocalStorageCreatorTemplateStore implements CreatorTemplateStore {
  constructor(
    private readonly storage: CreatorStorageLike = (globalThis as { localStorage?: CreatorStorageLike })
      .localStorage as CreatorStorageLike,
  ) {
    if (!this.storage) {
      throw new Error('LocalStorageCreatorTemplateStore: no localStorage available in this environment');
    }
  }

  private readAll(): CreatorTemplateRecord[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    try {
      return JSON.parse(raw) as CreatorTemplateRecord[];
    } catch {
      return [];
    }
  }

  private writeAll(records: CreatorTemplateRecord[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  get(templateId: string): CreatorTemplateRecord | undefined {
    const found = this.readAll().find((r) => r.meta.id === templateId);
    return found === undefined ? undefined : { authorId: found.authorId, meta: { ...found.meta } };
  }

  set(record: CreatorTemplateRecord): void {
    const all = this.readAll().filter((r) => r.meta.id !== record.meta.id);
    all.push({ authorId: record.authorId, meta: { ...record.meta } });
    this.writeAll(all);
  }

  list(): CreatorTemplateRecord[] {
    return this.readAll().map((r) => ({ authorId: r.authorId, meta: { ...r.meta } }));
  }
}

/**
 * MarketplaceSource over a CreatorTemplateStore: creator-uploaded templates
 * become catalog entries through the standard source seam (fetchIndex is
 * async per the interface; the store itself is synchronous).
 */
export class CreatorSource implements MarketplaceSource {
  readonly id = 'creator';

  constructor(private readonly store: CreatorTemplateStore = new MemoryCreatorTemplateStore()) {}

  fetchIndex(): Promise<TemplateMeta[]> {
    return Promise.resolve(this.store.list().map((r) => ({ ...r.meta })));
  }
}

/** Error raised for failed creator-template validation. */
export class CreatorTemplateValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = 'CreatorTemplateValidationError';
  }
}

/** Error raised when an author tries to edit a template they do not own. */
export class CreatorOwnershipError extends Error {
  constructor(templateId: string, authorId: string) {
    super(`Author '${authorId}' does not own template '${templateId}'`);
    this.name = 'CreatorOwnershipError';
  }
}

/** Fields of TemplateMeta a creator supplies at upload (id/author are set by the service). */
export type CreatorTemplateInput = Omit<TemplateMeta, 'entryConfig' | 'thumbnail' | 'author'> & {
  /** Optional thumbnail; defaults to a deterministic generated one. */
  thumbnail?: string;
};

/** Editable metadata fields for updateMeta(). */
export type CreatorMetaPatch = Partial<
  Pick<
    TemplateMeta,
    | 'name'
    | 'description'
    | 'version'
    | 'categories'
    | 'tags'
    | 'tier'
    | 'engineMinVersion'
    | 'previewSceneCount'
  >
>;

/**
 * Deterministic, render-free preview descriptor derived from a template's
 * entryConfig: a generated data-URI thumbnail, the scene count, and an
 * estimated duration (sum of scene track durations; ranges contribute their
 * span). Same entryConfig → same descriptor.
 */
export interface PreviewDescriptor {
  thumbnail: string;
  sceneCount: number;
  /** Estimated duration in seconds (sum of scene durations). */
  estimatedDuration: number;
}

/** Validate a candidate creator template meta + entryConfig. Returns issues (empty = valid). */
export function validateCreatorTemplate(meta: TemplateMeta): string[] {
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

/** Numeric duration of one scene track's durationOrRange (number or [start, end]). */
function trackDuration(durationOrRange: unknown): number {
  if (typeof durationOrRange === 'number' && Number.isFinite(durationOrRange)) {
    return Math.max(0, durationOrRange);
  }
  if (
    Array.isArray(durationOrRange) &&
    durationOrRange.length === 2 &&
    durationOrRange.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    return Math.max(0, (durationOrRange[1] as number) - (durationOrRange[0] as number));
  }
  return 0;
}

/** Service for creator template upload/edit/preview flows. */
export class CreatorTemplateService {
  constructor(
    private readonly store: CreatorTemplateStore = new MemoryCreatorTemplateStore(),
  ) {}

  /** A MarketplaceSource view over this service's store. */
  get source(): CreatorSource {
    return new CreatorSource(this.store);
  }

  /**
   * Upload a creator template. The entryConfig must pass parseConfig and the
   * version fields must be semver. The stored meta's author/id come from the
   * arguments; a deterministic thumbnail is generated when none is given.
   */
  uploadTemplate(
    authorId: string,
    meta: CreatorTemplateInput,
    entryConfig: EngineConfig,
  ): CreatorTemplateRecord {
    if (authorId.trim() === '') {
      throw new CreatorTemplateValidationError('authorId must be non-empty', [
        'authorId must be non-empty',
      ]);
    }
    if (this.store.get(meta.id) !== undefined) {
      throw new CreatorTemplateValidationError(`Template '${meta.id}' already exists`, [
        `duplicate template id '${meta.id}'`,
      ]);
    }
    const full: TemplateMeta = {
      ...meta,
      author: authorId,
      thumbnail: meta.thumbnail ?? makeThumbnail(meta.id),
      entryConfig,
    };
    const issues = validateCreatorTemplate(full);
    if (issues.length > 0) {
      throw new CreatorTemplateValidationError(
        `Template '${meta.id}' failed validation: ${issues.join('; ')}`,
        issues,
      );
    }
    const record: CreatorTemplateRecord = { authorId, meta: full };
    this.store.set(record);
    return { authorId, meta: { ...full } };
  }

  /**
   * Metadata editor: apply a patch to a creator template. Only the owning
   * author may edit; the patched meta is revalidated before it is stored.
   * entryConfig/thumbnail/author/id are not editable through this seam.
   */
  updateMeta(
    templateId: string,
    authorId: string,
    patch: CreatorMetaPatch,
  ): CreatorTemplateRecord {
    const record = this.store.get(templateId);
    if (record === undefined) {
      throw new CreatorTemplateValidationError(`Unknown template '${templateId}'`, [
        `no creator template with id '${templateId}'`,
      ]);
    }
    if (record.authorId !== authorId) {
      throw new CreatorOwnershipError(templateId, authorId);
    }
    const next: TemplateMeta = { ...record.meta, ...patch, id: record.meta.id };
    const issues = validateCreatorTemplate(next);
    if (issues.length > 0) {
      throw new CreatorTemplateValidationError(
        `Template '${templateId}' failed revalidation: ${issues.join('; ')}`,
        issues,
      );
    }
    const updated: CreatorTemplateRecord = { authorId: record.authorId, meta: next };
    this.store.set(updated);
    return { authorId: record.authorId, meta: { ...next } };
  }

  /**
   * Deterministic preview descriptor derived from the stored entryConfig.
   * No rendering: the thumbnail is the stored/generated data-URI, the scene
   * count and duration come straight from the config.
   */
  generatePreview(templateId: string): PreviewDescriptor {
    const record = this.store.get(templateId);
    if (record === undefined) {
      throw new CreatorTemplateValidationError(`Unknown template '${templateId}'`, [
        `no creator template with id '${templateId}'`,
      ]);
    }
    const scenes = (record.meta.entryConfig as { scenes?: Array<{ track?: { durationOrRange?: unknown } }> })
      .scenes;
    const list = Array.isArray(scenes) ? scenes : [];
    const estimatedDuration = list.reduce(
      (sum, scene) => sum + trackDuration(scene?.track?.durationOrRange),
      0,
    );
    return {
      thumbnail: record.meta.thumbnail,
      sceneCount: list.length,
      estimatedDuration,
    };
  }
}
