/**
 * HostedCollaboration — mirrors @lumen/app-collaboration:
 *   - membership/roles via `project_members` (role in owner/editor/viewer)
 *   - invitations CRUD on `invitations`; accept via security-definer
 *     rpc('accept_invitation', {token})
 *   - presence via realtime channel `presence:project:{id}` track/untrack
 *   - merge suggestions (`merge_suggestions`) and `activity_log` reads/appends
 */
import type { SupabaseClientLike } from './client.js';
import { unwrap, unwrapRows } from './client.js';

export type Role = 'owner' | 'editor' | 'viewer';

export interface HostedMember {
  projectId: string;
  userId: string;
  role: Role;
  addedAt: string;
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface HostedInvitation {
  id: string;
  projectId: string;
  email: string;
  role: Role;
  token: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

export interface HostedMergeSuggestion {
  id: string;
  projectId: string;
  userId: string;
  theirVersionId: string;
  headVersionId: string;
  nextConfig: unknown;
  fieldsChanged: string[];
  status: string;
  createdAt: string;
}

export interface HostedActivityEntry {
  id: number;
  projectId: string;
  actorId: string;
  action: string;
  detail: unknown;
  createdAt: string;
}

interface MemberRow {
  project_id: string;
  user_id: string;
  role: Role;
  added_at: string;
}

interface InvitationRow {
  id: string;
  project_id: string;
  email: string;
  role: Role;
  token: string;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
}

interface MergeSuggestionRow {
  id: string;
  project_id: string;
  user_id: string;
  their_version_id: string;
  head_version_id: string;
  next_config: unknown;
  fields_changed: string[];
  status: string;
  created_at: string;
}

interface ActivityRow {
  id: number;
  project_id: string;
  actor_id: string;
  action: string;
  detail: unknown;
  created_at: string;
}

function toMember(row: MemberRow): HostedMember {
  return { projectId: row.project_id, userId: row.user_id, role: row.role, addedAt: row.added_at };
}

function toInvitation(row: InvitationRow): HostedInvitation {
  return {
    id: row.id,
    projectId: row.project_id,
    email: row.email,
    role: row.role,
    token: row.token,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function toSuggestion(row: MergeSuggestionRow): HostedMergeSuggestion {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    theirVersionId: row.their_version_id,
    headVersionId: row.head_version_id,
    nextConfig: row.next_config,
    fieldsChanged: row.fields_changed,
    status: row.status,
    createdAt: row.created_at,
  };
}

function toActivity(row: ActivityRow): HostedActivityEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    actorId: row.actor_id,
    action: row.action,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

export interface PresenceState {
  userId: string;
  [key: string]: unknown;
}

export interface HostedCollaborationOptions {
  userId?: () => Promise<string | undefined>;
}

export class HostedCollaboration {
  private readonly client: SupabaseClientLike;
  private readonly resolveUserId: () => Promise<string | undefined>;

  constructor(client: SupabaseClientLike, options: HostedCollaborationOptions = {}) {
    this.client = client;
    this.resolveUserId =
      options.userId ??
      (async () => (await this.client.auth.getUser()).data?.id ?? undefined);
  }

  // ---------------------------------------------------------- membership --

  async listMembers(projectId: string): Promise<HostedMember[]> {
    const rows = await unwrapRows<MemberRow>(
      this.client.from('project_members').select().eq('project_id', projectId),
      'collaboration.listMembers',
    );
    return rows.map(toMember);
  }

  async addMember(projectId: string, userId: string, role: Role): Promise<HostedMember> {
    const row = await unwrap<MemberRow>(
      this.client
        .from('project_members')
        .upsert({ project_id: projectId, user_id: userId, role }, { onConflict: 'project_id,user_id' })
        .select()
        .single(),
      'collaboration.addMember',
    );
    return toMember(row);
  }

  async setRole(projectId: string, userId: string, role: Role): Promise<void> {
    await unwrapRows(
      this.client
        .from('project_members')
        .update({ role })
        .match({ project_id: projectId, user_id: userId })
        .select(),
      'collaboration.setRole',
    );
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    await unwrapRows(
      this.client
        .from('project_members')
        .delete()
        .match({ project_id: projectId, user_id: userId })
        .select(),
      'collaboration.removeMember',
    );
  }

  // --------------------------------------------------------- invitations --

  async invite(projectId: string, email: string, role: Role): Promise<HostedInvitation> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const row = await unwrap<InvitationRow>(
      this.client
        .from('invitations')
        .insert({ project_id: projectId, email, role, token, expires_at: expiresAt })
        .select()
        .single(),
      'collaboration.invite',
    );
    return toInvitation(row);
  }

  async listInvitations(projectId: string): Promise<HostedInvitation[]> {
    const rows = await unwrapRows<InvitationRow>(
      this.client
        .from('invitations')
        .select()
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
      'collaboration.listInvitations',
    );
    return rows.map(toInvitation);
  }

  async revokeInvitation(id: string): Promise<void> {
    await unwrapRows(
      this.client.from('invitations').update({ status: 'revoked' }).eq('id', id).select(),
      'collaboration.revokeInvitation',
    );
  }

  /** Accept by token via the security-definer SQL function. */
  async acceptInvitation(token: string): Promise<void> {
    const { error } = await this.client.rpc('accept_invitation', { token });
    if (error) throw new Error(`collaboration.acceptInvitation: ${error.message}`);
  }

  // ------------------------------------------------------------ presence --

  /**
   * Join `presence:project:{id}` and track the current user's presence.
   * Returns a leave() function that untracks and unsubscribes.
   */
  async joinPresence(
    projectId: string,
    state: Record<string, unknown> = {},
  ): Promise<{ leave: () => Promise<void> }> {
    const userId = (await this.resolveUserId()) ?? 'anonymous';
    const channel = this.client.channel(`presence:project:${projectId}`).subscribe();
    await channel.track({ userId, ...state });
    return {
      leave: async () => {
        await channel.untrack();
        await channel.unsubscribe();
      },
    };
  }

  // --------------------------------------------------- merge suggestions --

  async suggestMerge(input: {
    projectId: string;
    theirVersionId: string;
    headVersionId: string;
    nextConfig: unknown;
    fieldsChanged: string[];
  }): Promise<HostedMergeSuggestion> {
    const userId = (await this.resolveUserId()) ?? undefined;
    if (!userId) throw new Error('collaboration.suggestMerge: no authenticated user');
    const row = await unwrap<MergeSuggestionRow>(
      this.client
        .from('merge_suggestions')
        .insert({
          project_id: input.projectId,
          user_id: userId,
          their_version_id: input.theirVersionId,
          head_version_id: input.headVersionId,
          next_config: input.nextConfig,
          fields_changed: input.fieldsChanged,
        })
        .select()
        .single(),
      'collaboration.suggestMerge',
    );
    return toSuggestion(row);
  }

  async listMergeSuggestions(projectId: string): Promise<HostedMergeSuggestion[]> {
    const rows = await unwrapRows<MergeSuggestionRow>(
      this.client
        .from('merge_suggestions')
        .select()
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
      'collaboration.listMergeSuggestions',
    );
    return rows.map(toSuggestion);
  }

  // -------------------------------------------------------- activity log --

  async logActivity(projectId: string, action: string, detail: unknown = {}): Promise<void> {
    const actorId = (await this.resolveUserId()) ?? undefined;
    if (!actorId) throw new Error('collaboration.logActivity: no authenticated user');
    await unwrapRows(
      this.client
        .from('activity_log')
        .insert({ project_id: projectId, actor_id: actorId, action, detail })
        .select(),
      'collaboration.logActivity',
    );
  }

  async listActivity(projectId: string, limit = 100): Promise<HostedActivityEntry[]> {
    const rows = await unwrapRows<ActivityRow>(
      this.client
        .from('activity_log')
        .select()
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit),
      'collaboration.listActivity',
    );
    return rows.map(toActivity);
  }
}

function randomToken(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `tok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
