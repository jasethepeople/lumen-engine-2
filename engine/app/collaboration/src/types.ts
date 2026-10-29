/**
 * @lumen/app-collaboration — core types and seams.
 *
 * Everything is local-only and framework-free: invitations are mock tokens,
 * presence is an in-memory heartbeat table, and project access goes through
 * a minimal structural seam compatible with @lumen/app-projects' ProjectStore.
 */

/** Collaboration roles. Ordering is fixed: owner > editor > viewer. */
export type Role = 'owner' | 'editor' | 'viewer';

export interface Member {
  userId: string;
  role: Role;
  /** Epoch millis when the membership was granted. */
  addedAt: number;
}

/** EngineConfig-shaped configuration payload; validated by consumers. */
export type ProjectConfig = unknown;

export interface ProjectVersionRef {
  versionId: string;
  projectId: string;
  savedAt: string; // ISO-8601
  configSnapshot: ProjectConfig;
  label?: string;
}

export interface ProjectRef {
  id: string;
  config: ProjectConfig;
  updatedAt: string;
  [key: string]: unknown;
}

/**
 * Minimal seam over a project store. Structurally compatible with
 * @lumen/app-projects' ProjectStore (getProject / updateProject /
 * listVersions), so the real store can be passed directly.
 */
export interface ProjectStoreSeam {
  getProject(id: string): Promise<ProjectRef | undefined>;
  updateProject(
    id: string,
    patch: { config?: ProjectConfig; [key: string]: unknown },
    label?: string,
  ): Promise<ProjectRef>;
  listVersions(projectId: string): Promise<ProjectVersionRef[]>;
}

export interface PresenceEntry {
  userId: string;
  projectId: string;
  /** Epoch millis of the latest heartbeat. */
  lastSeenAt: number;
  cursor?: string;
}

export interface MergeSuggestion {
  id: string;
  projectId: string;
  userId: string;
  /** Version the editor based their edit on. */
  theirVersionId: string;
  /** Head version at the time the conflict was detected. */
  headVersionId: string;
  /** Top-level config keys whose values differ from head. */
  fieldsChanged: string[];
  /** The config payload proposed by the editor (applied on accept). */
  nextConfig: ProjectConfig;
  /** Epoch millis when the suggestion was produced. */
  suggestedAt: number;
  status: 'pending' | 'accepted' | 'dismissed';
}

export interface Invitation {
  token: string;
  projectId: string;
  email: string;
  role: Role;
  /** Epoch millis when the invitation was created. */
  createdAt: number;
  /** Epoch millis after which the invitation is no longer acceptable. */
  expiresAt: number;
  revoked: boolean;
}

export interface ActivityEntry {
  projectId: string;
  actorId: string;
  action: string;
  detail?: string;
  /** Epoch millis. */
  at: number;
}
