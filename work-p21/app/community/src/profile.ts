/**
 * @lumen/app-community — creator profiles.
 *
 * ProfileStore manages local-only creator profiles: unique validated
 * handles, deterministic avatar colors, and CRUD over a StorageLike seam
 * (memory by default, localStorage in the browser). No network calls.
 */

import { defaultCommunityStorage, readJson, writeJson, type StorageLike } from './storage.js';

/** Handle rule: lowercase slug, 3–24 chars. */
export const HANDLE_PATTERN = /^[a-z0-9-]{3,24}$/;

const STORAGE_KEY = 'lumen.community.profiles.v1';

/** A creator community profile. */
export interface CreatorProfile {
  /** Stable unique user id (generated at creation). */
  userId: string;
  /** Unique handle matching {@link HANDLE_PATTERN} (e.g. 'ada-creates'). */
  handle: string;
  /** Display name shown across the community surfaces. */
  displayName: string;
  /** Optional short bio. */
  bio?: string;
  /** Deterministic avatar color derived from the handle (hsl string). */
  avatarColor: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Optional external links (homepage, socials). */
  links?: string[];
}

/** Input for {@link ProfileStore.createProfile}. */
export interface CreateProfileInput {
  handle: string;
  displayName: string;
  bio?: string;
  links?: string[];
}

/** Patch for {@link ProfileStore.updateProfile} (userId/handle immutable). */
export interface UpdateProfilePatch {
  displayName?: string;
  bio?: string;
  links?: string[];
}

/** Thrown on handle validation or uniqueness failures. */
export class ProfileError extends Error {}

/** FNV-1a 32-bit hash — deterministic across runs and platforms. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic avatar color for a handle (same handle → same color). */
export function avatarColorFor(handle: string): string {
  const hue = fnv1a(handle) % 360;
  return `hsl(${hue},65%,55%)`;
}

/** Validate a handle; returns an error message or null when valid. */
export function validateHandle(handle: string): string | null {
  if (typeof handle !== 'string' || !HANDLE_PATTERN.test(handle)) {
    return `handle must match ${HANDLE_PATTERN.source} (3-24 chars: a-z, 0-9, '-')`;
  }
  return null;
}

const defaultId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export interface ProfileStoreOptions {
  storage?: StorageLike;
  /** Injectable clock returning epoch millis (for tests). */
  now?: () => number;
  /** Injectable id generator (for tests). */
  generateId?: () => string;
}

/**
 * ProfileStore — CRUD over creator profiles with handle validation and
 * uniqueness enforcement. Synchronous and local-only.
 */
export class ProfileStore {
  private readonly storage: StorageLike;
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(options: ProfileStoreOptions = {}) {
    this.storage = options.storage ?? defaultCommunityStorage();
    this.now = options.now ?? (() => Date.now());
    this.generateId = options.generateId ?? defaultId;
  }

  private loadAll(): CreatorProfile[] {
    return readJson<CreatorProfile[]>(this.storage, STORAGE_KEY, []);
  }

  private saveAll(profiles: CreatorProfile[]): void {
    writeJson(this.storage, STORAGE_KEY, profiles);
  }

  /** Create a profile; throws {@link ProfileError} on invalid/taken handle. */
  createProfile(input: CreateProfileInput): CreatorProfile {
    const handleError = validateHandle(input.handle);
    if (handleError) throw new ProfileError(`createProfile: ${handleError}`);
    if (!input.displayName || typeof input.displayName !== 'string') {
      throw new ProfileError('createProfile: displayName is required');
    }
    const profiles = this.loadAll();
    if (profiles.some((p) => p.handle === input.handle)) {
      throw new ProfileError(`createProfile: handle already taken: ${input.handle}`);
    }
    const profile: CreatorProfile = {
      userId: this.generateId(),
      handle: input.handle,
      displayName: input.displayName,
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      avatarColor: avatarColorFor(input.handle),
      createdAt: new Date(this.now()).toISOString(),
      ...(input.links !== undefined ? { links: [...input.links] } : {}),
    };
    profiles.push(profile);
    this.saveAll(profiles);
    return structuredClone(profile);
  }

  /** Update displayName/bio/links; handle and userId are immutable. */
  updateProfile(userId: string, patch: UpdateProfilePatch): CreatorProfile {
    const profiles = this.loadAll();
    const idx = profiles.findIndex((p) => p.userId === userId);
    if (idx === -1) throw new ProfileError(`updateProfile: profile not found: ${userId}`);
    if (patch.displayName !== undefined && !patch.displayName) {
      throw new ProfileError('updateProfile: displayName must be non-empty');
    }
    const updated: CreatorProfile = {
      ...profiles[idx],
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
      ...(patch.links !== undefined ? { links: [...patch.links] } : {}),
    };
    profiles[idx] = updated;
    this.saveAll(profiles);
    return structuredClone(updated);
  }

  /** Look up a profile by userId; undefined when absent. */
  getProfile(userId: string): CreatorProfile | undefined {
    const found = this.loadAll().find((p) => p.userId === userId);
    return found ? structuredClone(found) : undefined;
  }

  /** Look up a profile by handle; undefined when absent. */
  getByHandle(handle: string): CreatorProfile | undefined {
    const found = this.loadAll().find((p) => p.handle === handle);
    return found ? structuredClone(found) : undefined;
  }

  /** All profiles, sorted by handle for deterministic iteration. */
  listProfiles(): CreatorProfile[] {
    return this.loadAll().sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
  }
}
