/**
 * HostedProjectStore — mirrors @lumen/app-projects ProjectStore against the
 * `projects` + `project_versions` tables (SCHEMA.md). Version snapshots on
 * config updates are written by the `projects_after_update` SQL trigger, so
 * the client NEVER double-writes versions on update; it only reads them
 * (listVersions/restoreVersion/export) or inserts them explicitly on
 * importProject (new project, no trigger history yet).
 */
import type { SupabaseClientLike } from './client.js';
import { unwrap, unwrapRows } from './client.js';

export type ProjectConfig = unknown;

export interface Project {
  id: string;
  name: string;
  templateKind: string;
  templateId: string;
  config: ProjectConfig;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

export interface ProjectVersion {
  versionId: string;
  projectId: string;
  savedAt: string;
  configSnapshot: ProjectConfig;
  label?: string;
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

export const EXPORT_FORMAT_VERSION = 1;
export const PROJECT_SCHEMA_VERSION = 1;

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  template_kind: string;
  template_id: string;
  config: unknown;
  shared: boolean;
  schema_version: number;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  project_id: string;
  version_num: number;
  config: unknown;
  label: string | null;
  created_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    templateKind: row.template_kind,
    templateId: row.template_id,
    config: row.config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    schemaVersion: row.schema_version,
  };
}

function toVersion(row: VersionRow): ProjectVersion {
  const v: ProjectVersion = {
    versionId: row.id,
    projectId: row.project_id,
    savedAt: row.created_at,
    configSnapshot: row.config,
  };
  if (row.label !== null) v.label = row.label;
  return v;
}

export interface HostedProjectStoreOptions {
  /** Resolves the current user's id (defaults to client.auth.getUser()). */
  userId?: () => Promise<string | undefined>;
}

export class HostedProjectStore {
  private readonly client: SupabaseClientLike;
  private readonly resolveUserId: () => Promise<string | undefined>;

  constructor(client: SupabaseClientLike, options: HostedProjectStoreOptions = {}) {
    this.client = client;
    this.resolveUserId =
      options.userId ??
      (async () => (await this.client.auth.getUser()).data?.id ?? undefined);
  }

  private async requireUserId(): Promise<string> {
    const id = await this.resolveUserId();
    if (!id) throw new Error('projects: no authenticated user');
    return id;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    if (!input.name || typeof input.name !== 'string') {
      throw new Error('createProject: name is required');
    }
    const ownerId = await this.requireUserId();
    const row = await unwrap<ProjectRow>(
      this.client
        .from('projects')
        .insert({
          owner_id: ownerId,
          name: input.name,
          template_kind: input.templateKind,
          template_id: input.templateId,
          config: input.config ?? {},
          schema_version: PROJECT_SCHEMA_VERSION,
        })
        .select()
        .single(),
      'createProject',
    );
    return toProject(row);
  }

  async listProjects(): Promise<Project[]> {
    const rows = await unwrapRows<ProjectRow>(
      this.client.from('projects').select().order('updated_at', { ascending: false }),
      'listProjects',
    );
    return rows.map(toProject);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const { data, error } = await this.client
      .from('projects')
      .select()
      .eq('id', id)
      .single();
    if (error) return undefined;
    return data ? toProject(data as ProjectRow) : undefined;
  }

  /**
   * Update a project. On config changes the `projects_after_update` trigger
   * appends the version row; `label` is accepted for interface parity but
   * only applied client-side in offline mode.
   */
  async updateProject(id: string, patch: UpdateProjectPatch, label?: string): Promise<Project> {
    void label; // trigger-managed versioning has no label channel
    const values: Record<string, unknown> = {};
    if (patch.name !== undefined) values['name'] = patch.name;
    if (patch.templateKind !== undefined) values['template_kind'] = patch.templateKind;
    if (patch.templateId !== undefined) values['template_id'] = patch.templateId;
    if (patch.config !== undefined) values['config'] = patch.config;
    const row = await unwrap<ProjectRow>(
      this.client.from('projects').update(values).eq('id', id).select().single(),
      'updateProject',
    );
    return toProject(row);
  }

  async duplicateProject(id: string, newName?: string): Promise<Project> {
    const existing = await this.getProject(id);
    if (!existing) throw new Error(`duplicateProject: project not found: ${id}`);
    return this.createProject({
      name: newName ?? `${existing.name} (copy)`,
      templateKind: existing.templateKind,
      templateId: existing.templateId,
      config: existing.config,
    });
  }

  async deleteProject(id: string): Promise<boolean> {
    const existing = await this.getProject(id);
    if (!existing) return false;
    await unwrapRows(this.client.from('projects').delete().eq('id', id), 'deleteProject');
    return true;
  }

  async listVersions(projectId: string): Promise<ProjectVersion[]> {
    const rows = await unwrapRows<VersionRow>(
      this.client
        .from('project_versions')
        .select()
        .eq('project_id', projectId)
        .order('version_num', { ascending: true }),
      'listVersions',
    );
    return rows.map(toVersion);
  }

  /**
   * Restore by writing the historical snapshot back as the project's config;
   * the trigger then appends a NEW version (history is never mutated).
   */
  async restoreVersion(projectId: string, versionId: string): Promise<Project> {
    const versions = await this.listVersions(projectId);
    const target = versions.find((v) => v.versionId === versionId);
    if (!target) throw new Error(`restoreVersion: version not found: ${versionId}`);
    return this.updateProject(projectId, { config: target.configSnapshot });
  }

  async exportProject(projectId: string): Promise<string> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error(`exportProject: project not found: ${projectId}`);
    const envelope: ProjectExportEnvelope = {
      formatVersion: EXPORT_FORMAT_VERSION,
      project,
      versions: await this.listVersions(projectId),
    };
    return JSON.stringify(envelope, null, 2);
  }

  /**
   * Import an exported envelope. The new project row is inserted first, then
   * the carried-over versions are written explicitly (the trigger only fires
   * on UPDATE, so imported history would otherwise be lost).
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
    const p = env.project;
    if (!p || typeof p.name !== 'string') {
      throw new Error('importProject: project payload failed validation');
    }
    const project = await this.createProject({
      name: p.name,
      templateKind: p.templateKind,
      templateId: p.templateId,
      config: p.config,
    });
    const versions = Array.isArray(env.versions) ? env.versions : [];
    if (versions.length > 0) {
      const rows = versions.map((v, i) => {
        const row: Record<string, unknown> = {
          project_id: project.id,
          version_num: i + 1,
          config: v.configSnapshot,
        };
        if (v.label !== undefined) row['label'] = v.label;
        return row;
      });
      await unwrapRows(
        this.client.from('project_versions').insert(rows).select(),
        'importProject.versions',
      );
    }
    return project;
  }
}
