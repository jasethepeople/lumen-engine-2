/**
 * HostedCommunity — mirrors @lumen/app-community over `profiles`,
 * `templates`/`projects` (showcases are read-through views), `comments`
 * (threaded read; add/edit/soft-delete own via deleted_at) and `remixes`.
 *
 * Handle uniqueness: profiles.handle has a UNIQUE constraint; Postgres
 * error code 23505 is mapped to a typed HandleTakenError.
 */
import type { SupabaseClientLike, SupabaseErrorLike } from './client.js';
import { unwrap, unwrapRows } from './client.js';

/** Handle rule mirrored from @lumen/app-community / SCHEMA check. */
export const HANDLE_PATTERN = /^[a-z0-9-]{3,24}$/;

export class HandleTakenError extends Error {
  constructor(handle: string) {
    super(`handle already taken: ${handle}`);
    this.name = 'HandleTakenError';
  }
}

export interface HostedProfile {
  userId: string;
  handle: string;
  displayName: string;
  bio?: string;
  avatarColor?: string;
  links: string[];
  createdAt: string;
}

export interface HostedComment {
  id: string;
  targetKind: 'template' | 'project';
  targetId: string;
  authorId: string;
  parentId?: string;
  body: string;
  editedAt?: string;
  deleted: boolean;
  createdAt: string;
}

export interface HostedCommentNode extends HostedComment {
  children: HostedCommentNode[];
}

export interface HostedRemix {
  id: string;
  originalId: string;
  originalAuthorId: string;
  remixerId: string;
  newProjectId: string;
  createdAt: string;
}

interface ProfileRow {
  id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_color: string | null;
  links: string[];
  created_at: string;
}

interface CommentRow {
  id: string;
  target_kind: 'template' | 'project';
  target_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

interface RemixRow {
  id: string;
  original_id: string;
  original_author_id: string;
  remixer_id: string;
  new_project_id: string;
  created_at: string;
}

function toProfile(row: ProfileRow): HostedProfile {
  const p: HostedProfile = {
    userId: row.id,
    handle: row.handle,
    displayName: row.display_name,
    links: row.links ?? [],
    createdAt: row.created_at,
  };
  if (row.bio !== null) p.bio = row.bio;
  if (row.avatar_color !== null) p.avatarColor = row.avatar_color;
  return p;
}

function toComment(row: CommentRow): HostedComment {
  const c: HostedComment = {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    authorId: row.author_id,
    body: row.body,
    deleted: row.deleted_at !== null,
    createdAt: row.created_at,
  };
  if (row.parent_id !== null) c.parentId = row.parent_id;
  if (row.edited_at !== null) c.editedAt = row.edited_at;
  return c;
}

function isUniqueViolation(error: SupabaseErrorLike | null): boolean {
  return error?.code === '23505' || /duplicate key|unique/i.test(error?.message ?? '');
}

export interface HostedCommunityOptions {
  userId?: () => Promise<string | undefined>;
}

export class HostedCommunity {
  private readonly client: SupabaseClientLike;
  private readonly resolveUserId: () => Promise<string | undefined>;

  constructor(client: SupabaseClientLike, options: HostedCommunityOptions = {}) {
    this.client = client;
    this.resolveUserId =
      options.userId ??
      (async () => (await this.client.auth.getUser()).data?.id ?? undefined);
  }

  private async requireUserId(): Promise<string> {
    const id = await this.resolveUserId();
    if (!id) throw new Error('community: no authenticated user');
    return id;
  }

  // ------------------------------------------------------------ profiles --

  async createProfile(input: {
    handle: string;
    displayName: string;
    bio?: string;
    avatarColor?: string;
    links?: string[];
  }): Promise<HostedProfile> {
    if (!HANDLE_PATTERN.test(input.handle)) {
      throw new Error(`createProfile: invalid handle: ${input.handle}`);
    }
    const userId = await this.requireUserId();
    const { data, error } = await this.client
      .from('profiles')
      .insert({
        id: userId,
        handle: input.handle,
        display_name: input.displayName,
        bio: input.bio ?? null,
        avatar_color: input.avatarColor ?? null,
        links: input.links ?? [],
      })
      .select()
      .single();
    if (error) {
      if (isUniqueViolation(error)) throw new HandleTakenError(input.handle);
      throw new Error(`createProfile: ${error.message}`);
    }
    return toProfile(data as ProfileRow);
  }

  async getProfile(userId: string): Promise<HostedProfile | undefined> {
    const { data, error } = await this.client
      .from('profiles')
      .select()
      .eq('id', userId)
      .single();
    if (error) return undefined;
    return data ? toProfile(data as ProfileRow) : undefined;
  }

  async updateProfile(
    patch: { displayName?: string; bio?: string; links?: string[] },
  ): Promise<HostedProfile> {
    const userId = await this.requireUserId();
    const values: Record<string, unknown> = {};
    if (patch.displayName !== undefined) values['display_name'] = patch.displayName;
    if (patch.bio !== undefined) values['bio'] = patch.bio;
    if (patch.links !== undefined) values['links'] = patch.links;
    const row = await unwrap<ProfileRow>(
      this.client.from('profiles').update(values).eq('id', userId).select().single(),
      'community.updateProfile',
    );
    return toProfile(row);
  }

  // ----------------------------------------------------------- showcases --

  /** Showcase reads are pass-through views over templates/projects. */
  async listTemplateShowcases(): Promise<unknown[]> {
    return unwrapRows(
      this.client.from('templates').select().order('created_at', { ascending: false }),
      'community.listTemplateShowcases',
    );
  }

  async listProjectShowcases(): Promise<unknown[]> {
    return unwrapRows(
      this.client
        .from('projects')
        .select()
        .eq('shared', true)
        .order('updated_at', { ascending: false }),
      'community.listProjectShowcases',
    );
  }

  // ------------------------------------------------------------ comments --

  /** Threaded read of non-deleted comments for a target (2-level nesting). */
  async listComments(
    targetKind: 'template' | 'project',
    targetId: string,
  ): Promise<HostedCommentNode[]> {
    const rows = await unwrapRows<CommentRow>(
      this.client
        .from('comments')
        .select()
        .match({ target_kind: targetKind, target_id: targetId })
        .order('created_at', { ascending: true }),
      'community.listComments',
    );
    const nodes: HostedCommentNode[] = rows.map((r) => ({ ...toComment(r), children: [] }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const roots: HostedCommentNode[] = [];
    for (const node of nodes) {
      const parent = node.parentId !== undefined ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async addComment(
    targetKind: 'template' | 'project',
    targetId: string,
    body: string,
    parentId?: string,
  ): Promise<HostedComment> {
    if (body.length < 1 || body.length > 1000) {
      throw new Error('addComment: body must be 1..1000 characters');
    }
    const authorId = await this.requireUserId();
    const row = await unwrap<CommentRow>(
      this.client
        .from('comments')
        .insert({
          target_kind: targetKind,
          target_id: targetId,
          author_id: authorId,
          parent_id: parentId ?? null,
          body,
        })
        .select()
        .single(),
      'community.addComment',
    );
    return toComment(row);
  }

  /** Edit own comment (RLS enforces ownership server-side too). */
  async editComment(id: string, body: string): Promise<HostedComment> {
    const authorId = await this.requireUserId();
    const row = await unwrap<CommentRow>(
      this.client
        .from('comments')
        .update({ body, edited_at: new Date().toISOString() })
        .eq('id', id)
        .eq('author_id', authorId)
        .select()
        .single(),
      'community.editComment',
    );
    return toComment(row);
  }

  /** Soft-delete own comment via deleted_at. */
  async deleteComment(id: string): Promise<void> {
    const authorId = await this.requireUserId();
    await unwrapRows(
      this.client
        .from('comments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .eq('author_id', authorId)
        .select(),
      'community.deleteComment',
    );
  }

  // ------------------------------------------------------------- remixes --

  async recordRemix(input: {
    originalId: string;
    originalAuthorId: string;
    newProjectId: string;
  }): Promise<HostedRemix> {
    const remixerId = await this.requireUserId();
    const row = await unwrap<RemixRow>(
      this.client
        .from('remixes')
        .insert({
          original_id: input.originalId,
          original_author_id: input.originalAuthorId,
          remixer_id: remixerId,
          new_project_id: input.newProjectId,
        })
        .select()
        .single(),
      'community.recordRemix',
    );
    return {
      id: row.id,
      originalId: row.original_id,
      originalAuthorId: row.original_author_id,
      remixerId: row.remixer_id,
      newProjectId: row.new_project_id,
      createdAt: row.created_at,
    };
  }
}
