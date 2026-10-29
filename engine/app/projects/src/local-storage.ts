import type { Project, ProjectStorage, ProjectVersion } from './types.js';

const PROJECTS_KEY = 'lumen.projects.v1';
const versionsKey = (projectId: string) => `lumen.projects.v1.versions.${projectId}`;

/**
 * Browser localStorage adapter. Guards for non-browser environments: any
 * operation without a usable localStorage throws a descriptive error, and
 * `isAvailable()` lets callers pick MemoryStorage instead.
 */
export class LocalStorageAdapter implements ProjectStorage {
  static isAvailable(): boolean {
    try {
      return typeof localStorage !== 'undefined' && localStorage !== null;
    } catch {
      return false;
    }
  }

  private store(): Storage {
    if (!LocalStorageAdapter.isAvailable()) {
      throw new Error(
        'LocalStorageAdapter: localStorage is not available in this environment; use MemoryStorage instead.',
      );
    }
    return localStorage;
  }

  private readJson<T>(key: string, fallback: T): T {
    const raw = this.store().getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  }

  private writeJson(key: string, value: unknown): void {
    this.store().setItem(key, JSON.stringify(value));
  }

  async loadAll(): Promise<Project[]> {
    return this.readJson<Project[]>(PROJECTS_KEY, []);
  }

  async saveProject(p: Project): Promise<void> {
    const all = await this.loadAll();
    const idx = all.findIndex((x) => x.id === p.id);
    if (idx >= 0) all[idx] = p;
    else all.push(p);
    this.writeJson(PROJECTS_KEY, all);
  }

  async deleteProject(id: string): Promise<void> {
    const all = await this.loadAll();
    this.writeJson(PROJECTS_KEY, all.filter((x) => x.id !== id));
    this.store().removeItem(versionsKey(id));
  }

  async loadVersions(projectId: string): Promise<ProjectVersion[]> {
    return this.readJson<ProjectVersion[]>(versionsKey(projectId), []);
  }

  async appendVersion(v: ProjectVersion): Promise<void> {
    const list = await this.loadVersions(v.projectId);
    list.push(v);
    this.writeJson(versionsKey(v.projectId), list);
  }

  async pruneVersions(projectId: string, keep: number): Promise<void> {
    const list = await this.loadVersions(projectId);
    if (list.length > keep) {
      this.writeJson(versionsKey(projectId), list.slice(list.length - keep));
    }
  }
}
