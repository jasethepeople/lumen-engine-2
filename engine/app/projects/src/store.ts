import {
  DEFAULT_MAX_VERSIONS,
  EXPORT_FORMAT_VERSION,
  PROJECT_SCHEMA_VERSION,
  type CreateProjectInput,
  type Project,
  type ProjectExportEnvelope,
  type ProjectStorage,
  type ProjectVersion,
  type UpdateProjectPatch,
} from './types.js';
import { MemoryStorage } from './memory-storage.js';

export interface ProjectStoreOptions {
  /** Retention cap on version history per project (default 50). */
  maxVersions?: number;
  /** Injectable clock returning epoch millis (for tests). */
  now?: () => number;
  /** Injectable id generator (defaults to crypto.randomUUID). */
  generateId?: () => string;
}

const defaultId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * ProjectStore — CRUD over projects with immutable version history,
 * retention pruning and portable import/export. Framework-free.
 */
export class ProjectStore {
  private readonly storage: ProjectStorage;
  private readonly maxVersions: number;
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(storage?: ProjectStorage, options: ProjectStoreOptions = {}) {
    this.storage = storage ?? new MemoryStorage();
    this.maxVersions = options.maxVersions ?? DEFAULT_MAX_VERSIONS;
    this.now = options.now ?? (() => Date.now());
    this.generateId = options.generateId ?? defaultId;
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private async persistWithVersion(
    project: Project,
    label: string | undefined,
    previousVersionsAppend: boolean,
  ): Promise<void> {
    await this.storage.saveProject(project);
    if (previousVersionsAppend) {
      await this.storage.appendVersion({
        versionId: this.generateId(),
        projectId: project.id,
        savedAt: project.updatedAt,
        configSnapshot: structuredClone(project.config),
        ...(label !== undefined ? { label } : {}),
      });
      await this.storage.pruneVersions(project.id, this.maxVersions);
    }
  }

  // ---------------------------------------------------------------- CRUD --

  async createProject(input: CreateProjectInput): Promise<Project> {
    if (!input.name || typeof input.name !== 'string') {
      throw new Error('createProject: name is required');
    }
    const ts = this.iso();
    const project: Project = {
      id: this.generateId(),
      name: input.name,
      templateKind: input.templateKind,
      templateId: input.templateId,
      config: input.config ?? {},
      createdAt: ts,
      updatedAt: ts,
      schemaVersion: PROJECT_SCHEMA_VERSION,
    };
    await this.persistWithVersion(project, 'created', true);
    return structuredClone(project);
  }

  async listProjects(): Promise<Project[]> {
    return this.storage.loadAll();
  }

  async getProject(id: string): Promise<Project | undefined> {
    const all = await this.storage.loadAll();
    const found = all.find((p) => p.id === id);
    return found ? structuredClone(found) : undefined;
  }

  async updateProject(
    id: string,
    patch: UpdateProjectPatch,
    label?: string,
  ): Promise<Project> {
    const existing = await this.getProject(id);
    if (!existing) throw new Error(`updateProject: project not found: ${id}`);
    const updated: Project = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.templateKind !== undefined ? { templateKind: patch.templateKind } : {}),
      ...(patch.templateId !== undefined ? { templateId: patch.templateId } : {}),
      ...(patch.config !== undefined ? { config: patch.config } : {}),
      updatedAt: this.iso(),
    };
    await this.persistWithVersion(updated, label, true);
    return structuredClone(updated);
  }

  async duplicateProject(id: string, newName?: string): Promise<Project> {
    const existing = await this.getProject(id);
    if (!existing) throw new Error(`duplicateProject: project not found: ${id}`);
    const ts = this.iso();
    const copy: Project = {
      ...existing,
      id: this.generateId(),
      name: newName ?? `${existing.name} (copy)`,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.persistWithVersion(copy, 'duplicated', true);
    return structuredClone(copy);
  }

  async deleteProject(id: string): Promise<boolean> {
    const existing = await this.getProject(id);
    if (!existing) return false;
    await this.storage.deleteProject(id);
    return true;
  }

  // ---------------------------------------------------------- versioning --

  async listVersions(projectId: string): Promise<ProjectVersion[]> {
    return this.storage.loadVersions(projectId);
  }

  /**
   * Restore a historical version. History is never mutated: restoring
   * creates a NEW version whose snapshot is the restored config.
   */
  async restoreVersion(projectId: string, versionId: string): Promise<Project> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error(`restoreVersion: project not found: ${projectId}`);
    const versions = await this.storage.loadVersions(projectId);
    const target = versions.find((v) => v.versionId === versionId);
    if (!target) throw new Error(`restoreVersion: version not found: ${versionId}`);
    const restored: Project = {
      ...project,
      config: structuredClone(target.configSnapshot),
      updatedAt: this.iso(),
    };
    await this.persistWithVersion(restored, `restored from ${versionId}`, true);
    return structuredClone(restored);
  }

  // -------------------------------------------------------- import/export --

  async exportProject(projectId: string): Promise<string> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error(`exportProject: project not found: ${projectId}`);
    const envelope: ProjectExportEnvelope = {
      formatVersion: EXPORT_FORMAT_VERSION,
      project,
      versions: await this.storage.loadVersions(projectId),
    };
    return JSON.stringify(envelope, null, 2);
  }

  /**
   * Import a previously exported project. Validates the envelope and assigns
   * a new project id to avoid collisions with existing projects.
   */
  async importProject(json: string): Promise<Project> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('importProject: invalid JSON');
    }
    const env = parsed as Partial<ProjectExportEnvelope>;
    if (typeof env !== 'object' || env === null) {
      throw new Error('importProject: payload must be an object');
    }
    if (env.formatVersion !== EXPORT_FORMAT_VERSION) {
      throw new Error(`importProject: unsupported formatVersion: ${String(env.formatVersion)}`);
    }
    const p = env.project as Partial<Project> | undefined;
    if (
      !p ||
      typeof p.id !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.templateKind !== 'string' ||
      typeof p.templateId !== 'string' ||
      !('config' in p) ||
      typeof p.createdAt !== 'string' ||
      typeof p.updatedAt !== 'string' ||
      typeof p.schemaVersion !== 'number'
    ) {
      throw new Error('importProject: project payload failed validation');
    }
    const versions = Array.isArray(env.versions) ? env.versions : [];
    for (const v of versions) {
      const ver = v as Partial<ProjectVersion>;
      if (
        typeof ver?.versionId !== 'string' ||
        typeof ver.projectId !== 'string' ||
        typeof ver.savedAt !== 'string' ||
        !('configSnapshot' in ver)
      ) {
        throw new Error('importProject: version payload failed validation');
      }
    }

    // New id assignment (loop guards the astronomically unlikely collision).
    const existing = await this.storage.loadAll();
    const taken = new Set(existing.map((x) => x.id));
    let newId = this.generateId();
    while (taken.has(newId)) newId = this.generateId();

    const ts = this.iso();
    const project: Project = {
      id: newId,
      name: p.name,
      templateKind: p.templateKind,
      templateId: p.templateId,
      config: structuredClone(p.config),
      createdAt: p.createdAt,
      updatedAt: ts,
      schemaVersion: p.schemaVersion,
    };
    await this.storage.saveProject(project);
    for (const v of versions) {
      await this.storage.appendVersion({
        versionId: this.generateId(),
        projectId: newId,
        savedAt: (v as ProjectVersion).savedAt,
        configSnapshot: structuredClone((v as ProjectVersion).configSnapshot),
        ...((v as ProjectVersion).label !== undefined
          ? { label: (v as ProjectVersion).label }
          : {}),
      });
    }
    await this.persistWithVersion(project, 'imported', true);
    return structuredClone(project);
  }
}
