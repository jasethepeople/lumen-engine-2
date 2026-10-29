/**
 * @lumen/app-projects — core types and storage seam.
 *
 * Framework-free TypeScript so builder, runtime and CLI can all consume it.
 */

export const PROJECT_SCHEMA_VERSION = 1;
export const EXPORT_FORMAT_VERSION = 1;
export const DEFAULT_MAX_VERSIONS = 50;

/** EngineConfig-shaped configuration payload; validated by consumers. */
export type ProjectConfig = unknown;

export interface Project {
  id: string;
  name: string;
  templateKind: string;
  templateId: string;
  config: ProjectConfig;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  schemaVersion: number;
}

export interface ProjectVersion {
  versionId: string;
  projectId: string;
  savedAt: string; // ISO-8601
  configSnapshot: ProjectConfig;
  label?: string;
}

/** Storage adapter seam. All methods are async for adapter parity. */
export interface ProjectStorage {
  loadAll(): Promise<Project[]>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  loadVersions(projectId: string): Promise<ProjectVersion[]>;
  appendVersion(v: ProjectVersion): Promise<void>;
  pruneVersions(projectId: string, keep: number): Promise<void>;
}

export interface CreateProjectInput {
  name: string;
  templateKind: string;
  templateId: string;
  config?: ProjectConfig;
}

export interface UpdateProjectPatch {
  name?: string;
  templateKind?: string;
  templateId?: string;
  config?: ProjectConfig;
}

export interface ProjectExportEnvelope {
  formatVersion: number;
  project: Project;
  versions: ProjectVersion[];
}
