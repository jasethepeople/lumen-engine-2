/**
 * @lumen/app-community — remix flow.
 *
 * Remixing clones a showcased template's entryConfig into a brand-new project
 * via the ProjectStore seam, then records a RemixRecord for attribution and
 * counts. Local-only; the ProjectStore used is whatever the caller injects.
 */

import type { ProjectStore } from '@lumen/app-projects';
import type { ProfileStore } from './profile.js';
import type { CommunityShowcase } from './showcase.js';
import { defaultCommunityStorage, readJson, writeJson, type StorageLike } from './storage.js';

const REMIX_KEY = 'lumen.community.remixes.v1';

/** A record that one showcased template was remixed into a new project. */
export interface RemixRecord {
  /** Showcase entry id of the original template. */
  originalId: string;
  /** Profile userId of the original author. */
  originalAuthorId: string;
  /** Profile userId of the remixer. */
  remixerId: string;
  /** Id of the newly created project in the remixer's ProjectStore. */
  newProjectId: string;
  /** ISO-8601 timestamp of the remix. */
  remixedAt: string;
}

/** Thrown on remix validation failures. */
export class RemixError extends Error {}

export interface RemixServiceOptions {
  storage?: StorageLike;
  now?: () => number;
}

/** RemixService — clone showcased templates into new projects + attribution. */
export class RemixService {
  private readonly storage: StorageLike;
  private readonly now: () => number;

  constructor(
    private readonly showcase: CommunityShowcase,
    private readonly profiles: ProfileStore,
    options: RemixServiceOptions = {},
  ) {
    this.storage = options.storage ?? defaultCommunityStorage();
    this.now = options.now ?? (() => Date.now());
  }

  private loadRecords(): RemixRecord[] {
    return readJson<RemixRecord[]>(this.storage, REMIX_KEY, []);
  }

  /**
   * Remix a showcased template: clones its entryConfig into a NEW project
   * owned by the remixer (via the injected ProjectStore seam) and records a
   * RemixRecord. Returns the record.
   */
  async remixTemplate(
    showcaseEntryId: string,
    remixerId: string,
    projectStore: ProjectStore,
  ): Promise<RemixRecord> {
    const entry = this.showcase.getTemplateEntry(showcaseEntryId);
    if (!entry) {
      throw new RemixError(`remixTemplate: showcase entry not found: ${showcaseEntryId}`);
    }
    if (!this.profiles.getProfile(remixerId)) {
      throw new RemixError(`remixTemplate: unknown remixer profile: ${remixerId}`);
    }
    const project = await projectStore.createProject({
      name: `Remix of ${entry.meta.name}`,
      templateKind: entry.meta.templateKind,
      templateId: entry.meta.id,
      config: structuredClone(entry.meta.entryConfig),
    });
    const record: RemixRecord = {
      originalId: entry.id,
      originalAuthorId: entry.profileId,
      remixerId,
      newProjectId: project.id,
      remixedAt: new Date(this.now()).toISOString(),
    };
    const records = this.loadRecords();
    records.push(record);
    writeJson(this.storage, REMIX_KEY, records);
    return { ...record };
  }

  /** All remix records for a showcase entry (oldest first). */
  listRemixes(originalId: string): RemixRecord[] {
    return this.loadRecords()
      .filter((r) => r.originalId === originalId)
      .map((r) => ({ ...r }));
  }

  /** Number of times a showcase entry has been remixed. */
  remixCount(originalId: string): number {
    return this.loadRecords().filter((r) => r.originalId === originalId).length;
  }

  /**
   * Attribution string for a showcased template:
   * 'Remixed from <template name> by <author handle>'.
   */
  attributionFor(originalId: string): string {
    const entry = this.showcase.getTemplateEntry(originalId);
    if (!entry) throw new RemixError(`attributionFor: showcase entry not found: ${originalId}`);
    const author = this.profiles.getProfile(entry.profileId);
    const handle = author?.handle ?? 'unknown';
    return `Remixed from ${entry.meta.name} by ${handle}`;
  }
}
