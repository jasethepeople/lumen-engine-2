/**
 * @lumen/app-community — community showcases.
 *
 * Creators publish marketplace TemplateMeta entries and project snapshots to
 * a local-only community gallery. Every published config is validated with
 * `parseConfig` from @lumen/config before it is accepted. Featured rotation
 * is deterministic by date (same day → same featured entry).
 */

import { parseConfig } from '@lumen/config';
import type { TemplateMeta, Category } from '@lumen/app-marketplace';
import { isSemver } from '@lumen/app-marketplace';
import type { ProfileStore } from './profile.js';
import { defaultCommunityStorage, readJson, writeJson, type StorageLike } from './storage.js';

const TEMPLATE_KEY = 'lumen.community.showcase.templates.v1';
const PROJECT_KEY = 'lumen.community.showcase.projects.v1';

/** A template published to the community gallery. */
export interface TemplateShowcaseEntry {
  /** Stable unique showcase entry id. */
  id: string;
  /** Author profile userId. */
  profileId: string;
  /** The published marketplace template metadata (entryConfig validated). */
  meta: TemplateMeta;
  /** ISO-8601 publish timestamp. */
  showcasedAt: string;
}

/** A project published to the community gallery. */
export interface ProjectShowcaseEntry {
  /** Stable unique showcase entry id. */
  id: string;
  /** Author profile userId. */
  profileId: string;
  /** Id of the source project in the author's ProjectStore. */
  projectId: string;
  title: string;
  description: string;
  /** EngineConfig-shaped snapshot, validated with parseConfig. */
  configSnapshot: unknown;
  /** Optional inline thumbnail (data URI). */
  thumbnail?: string;
  /** ISO-8601 publish timestamp. */
  showcasedAt: string;
}

/** Input for {@link CommunityShowcase.showcaseProject}. */
export interface ShowcaseProjectInput {
  projectId: string;
  title: string;
  description: string;
  configSnapshot: unknown;
  thumbnail?: string;
}

/** Filters for {@link CommunityShowcase.listShowcase}. */
export interface ShowcaseFilters {
  category?: Category;
  /** Filter by author profile userId. */
  author?: string;
}

/** Thrown when a showcase entry fails validation. */
export class ShowcaseValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

const defaultId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** FNV-1a 32-bit hash — deterministic across runs and platforms. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface CommunityShowcaseOptions {
  storage?: StorageLike;
  now?: () => number;
  generateId?: () => string;
}

/**
 * CommunityShowcase — template + project galleries. Validates configs via
 * parseConfig, enforces author existence via ProfileStore, and offers
 * deterministic featured rotation keyed on the calendar date.
 */
export class CommunityShowcase {
  private readonly storage: StorageLike;
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(
    private readonly profiles: ProfileStore,
    options: CommunityShowcaseOptions = {},
  ) {
    this.storage = options.storage ?? defaultCommunityStorage();
    this.now = options.now ?? (() => Date.now());
    this.generateId = options.generateId ?? defaultId;
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private loadTemplates(): TemplateShowcaseEntry[] {
    return readJson<TemplateShowcaseEntry[]>(this.storage, TEMPLATE_KEY, []);
  }

  private loadProjects(): ProjectShowcaseEntry[] {
    return readJson<ProjectShowcaseEntry[]>(this.storage, PROJECT_KEY, []);
  }

  private requireProfile(profileId: string, op: string): void {
    if (!this.profiles.getProfile(profileId)) {
      throw new ShowcaseValidationError(`${op}: unknown author profile: ${profileId}`);
    }
  }

  /** Validate a TemplateMeta enough for showcase (entryConfig via parseConfig). */
  private validateTemplateMeta(meta: TemplateMeta): void {
    const issues: string[] = [];
    if (!meta || typeof meta !== 'object') {
      throw new ShowcaseValidationError('showcaseTemplate: meta is required');
    }
    if (!meta.id) issues.push('meta.id is required');
    if (!meta.name) issues.push('meta.name is required');
    if (!Array.isArray(meta.categories) || meta.categories.length === 0) {
      issues.push('meta.categories must be a non-empty array');
    }
    if (meta.version !== undefined && !isSemver(meta.version)) {
      issues.push(`meta.version is not semver: ${String(meta.version)}`);
    }
    if (issues.length > 0) {
      throw new ShowcaseValidationError('showcaseTemplate: invalid template meta', issues);
    }
    const parsed = parseConfig(meta.entryConfig);
    if (!parsed.ok) {
      throw new ShowcaseValidationError(
        'showcaseTemplate: entryConfig failed validation',
        parsed.errors.map((e) => `${e.path}: ${e.message}`),
      );
    }
  }

  /** Publish a template to the community gallery. */
  showcaseTemplate(profileId: string, templateMeta: TemplateMeta): TemplateShowcaseEntry {
    this.requireProfile(profileId, 'showcaseTemplate');
    this.validateTemplateMeta(templateMeta);
    const entries = this.loadTemplates();
    if (entries.some((e) => e.profileId === profileId && e.meta.id === templateMeta.id)) {
      throw new ShowcaseValidationError(
        `showcaseTemplate: template already showcased by this author: ${templateMeta.id}`,
      );
    }
    const entry: TemplateShowcaseEntry = {
      id: this.generateId(),
      profileId,
      meta: structuredClone(templateMeta),
      showcasedAt: this.iso(),
    };
    entries.push(entry);
    writeJson(this.storage, TEMPLATE_KEY, entries);
    return structuredClone(entry);
  }

  /** List showcased templates, newest first, with optional filters. */
  listShowcase(filters: ShowcaseFilters = {}): TemplateShowcaseEntry[] {
    return this.loadTemplates()
      .filter((e) => {
        if (filters.category !== undefined && !e.meta.categories.includes(filters.category)) {
          return false;
        }
        if (filters.author !== undefined && e.profileId !== filters.author) return false;
        return true;
      })
      .sort((a, b) => (a.showcasedAt < b.showcasedAt ? 1 : a.showcasedAt > b.showcasedAt ? -1 : 0))
      .map((e) => structuredClone(e));
  }

  /** Look up a template showcase entry by id. */
  getTemplateEntry(id: string): TemplateShowcaseEntry | undefined {
    const found = this.loadTemplates().find((e) => e.id === id);
    return found ? structuredClone(found) : undefined;
  }

  /**
   * Deterministic featured rotation: the featured template entry for a date
   * is `entries[fnv1a(date) % entries.length]` over id-sorted entries, so
   * everyone sees the same featured entry on the same day.
   */
  featured(date: string | Date = new Date(this.now())): TemplateShowcaseEntry | undefined {
    const entries = this.loadTemplates().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (entries.length === 0) return undefined;
    const day = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
    const idx = fnv1a(day) % entries.length;
    return structuredClone(entries[idx]);
  }

  /** Publish a project snapshot to the community gallery. */
  showcaseProject(profileId: string, input: ShowcaseProjectInput): ProjectShowcaseEntry {
    this.requireProfile(profileId, 'showcaseProject');
    if (!input.projectId) {
      throw new ShowcaseValidationError('showcaseProject: projectId is required');
    }
    if (!input.title) {
      throw new ShowcaseValidationError('showcaseProject: title is required');
    }
    const parsed = parseConfig(input.configSnapshot);
    if (!parsed.ok) {
      throw new ShowcaseValidationError(
        'showcaseProject: configSnapshot failed validation',
        parsed.errors.map((e) => `${e.path}: ${e.message}`),
      );
    }
    const entries = this.loadProjects();
    const entry: ProjectShowcaseEntry = {
      id: this.generateId(),
      profileId,
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? '',
      configSnapshot: structuredClone(input.configSnapshot),
      ...(input.thumbnail !== undefined ? { thumbnail: input.thumbnail } : {}),
      showcasedAt: this.iso(),
    };
    entries.push(entry);
    writeJson(this.storage, PROJECT_KEY, entries);
    return structuredClone(entry);
  }

  /** List showcased projects, newest first, optionally by author. */
  listProjectShowcase(filters: { author?: string } = {}): ProjectShowcaseEntry[] {
    return this.loadProjects()
      .filter((e) => filters.author === undefined || e.profileId === filters.author)
      .sort((a, b) => (a.showcasedAt < b.showcasedAt ? 1 : a.showcasedAt > b.showcasedAt ? -1 : 0))
      .map((e) => structuredClone(e));
  }

  /** Look up a project showcase entry by id. */
  getProjectEntry(id: string): ProjectShowcaseEntry | undefined {
    const found = this.loadProjects().find((e) => e.id === id);
    return found ? structuredClone(found) : undefined;
  }
}
