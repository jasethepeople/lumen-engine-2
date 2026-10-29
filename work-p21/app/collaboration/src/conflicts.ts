import type {
  MergeSuggestion,
  ProjectConfig,
  ProjectStoreSeam,
} from './types.js';

export interface ConflictResolverOptions {
  /** Injectable clock returning epoch millis (for tests). */
  now?: () => number;
  /** Injectable id generator (defaults to crypto.randomUUID). */
  generateId?: () => string;
}

export interface ApplyEditResult {
  /** The edit was written as the new head (always, under last-write-wins). */
  applied: true;
  /** New head version id after the write, when discoverable. */
  headVersionId?: string;
  /** Present when the edit was based on a stale version. */
  suggestion?: MergeSuggestion;
}

const defaultId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * ConflictResolver — last-write-wins edits against the current head version,
 * with a merge-suggestion inbox for edits based on stale versions.
 */
export class ConflictResolver {
  private readonly store: ProjectStoreSeam;
  private readonly now: () => number;
  private readonly generateId: () => string;
  private readonly inbox = new Map<string, MergeSuggestion>();

  constructor(store: ProjectStoreSeam, options: ConflictResolverOptions = {}) {
    this.store = store;
    this.now = options.now ?? (() => Date.now());
    this.generateId = options.generateId ?? defaultId;
  }

  private async headVersionId(projectId: string): Promise<string | undefined> {
    const versions = await this.store.listVersions(projectId);
    return versions.length > 0 ? versions[versions.length - 1]!.versionId : undefined;
  }

  /** Top-level config keys whose values differ between two configs. */
  static fieldsChanged(base: ProjectConfig, next: ProjectConfig): string[] {
    const a = (base ?? {}) as Record<string, unknown>;
    const b = (next ?? {}) as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].filter((k) => !Object.is(a[k], b[k])).sort();
  }

  /**
   * Apply an edit with last-write-wins semantics: `nextConfig` always
   * becomes the new head. When `baseVersionId` differs from the current
   * head, a MergeSuggestion is recorded in the inbox so a human can review
   * the fields that raced.
   */
  async applyEdit(
    projectId: string,
    userId: string,
    baseVersionId: string,
    nextConfig: ProjectConfig,
  ): Promise<ApplyEditResult> {
    const project = await this.store.getProject(projectId);
    if (!project) throw new Error(`applyEdit: project not found: ${projectId}`);
    const headBefore = await this.headVersionId(projectId);

    let suggestion: MergeSuggestion | undefined;
    if (headBefore !== undefined && headBefore !== baseVersionId) {
      suggestion = {
        id: this.generateId(),
        projectId,
        userId,
        theirVersionId: baseVersionId,
        headVersionId: headBefore,
        fieldsChanged: ConflictResolver.fieldsChanged(project.config, nextConfig),
        nextConfig,
        suggestedAt: this.now(),
        status: 'pending',
      };
      this.inbox.set(suggestion.id, suggestion);
    }

    await this.store.updateProject(
      projectId,
      { config: nextConfig },
      `edit by ${userId}`,
    );
    const headAfter = await this.headVersionId(projectId);
    return {
      applied: true,
      ...(headAfter !== undefined ? { headVersionId: headAfter } : {}),
      ...(suggestion !== undefined ? { suggestion } : {}),
    };
  }

  /** Pending (and resolved) suggestions for a project, oldest first. */
  listMergeSuggestions(projectId: string): MergeSuggestion[] {
    return [...this.inbox.values()]
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => a.suggestedAt - b.suggestedAt)
      .map((s) => ({ ...s }));
  }

  private get(id: string): MergeSuggestion {
    const s = this.inbox.get(id);
    if (!s) throw new Error(`suggestion not found: ${id}`);
    if (s.status !== 'pending') {
      throw new Error(`suggestion ${id} is already ${s.status}`);
    }
    return s;
  }

  /** Accept a suggestion: its config becomes a new version via the store. */
  async acceptSuggestion(id: string): Promise<void> {
    const s = this.get(id);
    await this.store.updateProject(
      s.projectId,
      { config: s.nextConfig },
      `accepted merge suggestion ${id}`,
    );
    s.status = 'accepted';
  }

  /** Dismiss a suggestion without applying it. */
  dismiss(id: string): void {
    this.get(id).status = 'dismissed';
  }
}
