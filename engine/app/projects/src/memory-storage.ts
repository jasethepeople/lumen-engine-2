import type { Project, ProjectStorage, ProjectVersion } from './types.js';

/**
 * In-memory storage adapter — default for tests, CLI and headless use.
 * Keeps insertion order for deterministic listing.
 */
export class MemoryStorage implements ProjectStorage {
  private readonly projects = new Map<string, Project>();
  private readonly versions = new Map<string, ProjectVersion[]>();

  async loadAll(): Promise<Project[]> {
    return [...this.projects.values()].map((p) => structuredClone(p));
  }

  async saveProject(p: Project): Promise<void> {
    this.projects.set(p.id, structuredClone(p));
  }

  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
    this.versions.delete(id);
  }

  async loadVersions(projectId: string): Promise<ProjectVersion[]> {
    return (this.versions.get(projectId) ?? []).map((v) => structuredClone(v));
  }

  async appendVersion(v: ProjectVersion): Promise<void> {
    const list = this.versions.get(v.projectId) ?? [];
    list.push(structuredClone(v));
    this.versions.set(v.projectId, list);
  }

  async pruneVersions(projectId: string, keep: number): Promise<void> {
    const list = this.versions.get(projectId);
    if (!list) return;
    if (list.length > keep) {
      this.versions.set(projectId, list.slice(list.length - keep));
    }
  }
}
