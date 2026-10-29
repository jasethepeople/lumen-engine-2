import type { ProjectStoreSeam, Role } from './types.js';
import type { MembershipStore } from './membership.js';
import { canEdit } from './roles.js';

export interface AccessCheck {
  allowed: boolean;
  role?: Role;
  reason?: string;
}

/**
 * CollaborationService — shared-project flows over a ProjectStore seam plus
 * a MembershipStore. Sharing is a local flag/membership concept; there is no
 * network or server sync.
 */
export class CollaborationService {
  private readonly store: ProjectStoreSeam;
  private readonly memberships: MembershipStore;
  private readonly shared = new Set<string>();

  constructor(store: ProjectStoreSeam, memberships: MembershipStore) {
    this.store = store;
    this.memberships = memberships;
  }

  /**
   * Mark a project as shared and record the owner as its first member.
   * Idempotent: re-sharing keeps existing memberships.
   */
  async shareProject(projectId: string, ownerId: string): Promise<void> {
    const project = await this.store.getProject(projectId);
    if (!project) throw new Error(`shareProject: project not found: ${projectId}`);
    this.shared.add(projectId);
    const role = await this.memberships.getRole(projectId, ownerId);
    if (role !== 'owner') {
      await this.memberships.addMember(projectId, ownerId, 'owner');
    }
  }

  /** Ids of shared projects the user is a member of. */
  async listSharedWith(userId: string): Promise<string[]> {
    const projectIds = await this.memberships.projectsFor(userId);
    return projectIds.filter((id) => this.shared.has(id));
  }

  /** Whether a project has been shared at all. */
  isShared(projectId: string): boolean {
    return this.shared.has(projectId);
  }

  /**
   * Access check combining sharing state, membership and role.
   * `intent` defaults to 'view'; 'edit' requires an editor-or-higher role.
   */
  async checkAccess(
    projectId: string,
    userId: string,
    intent: 'view' | 'edit' = 'view',
  ): Promise<AccessCheck> {
    const project = await this.store.getProject(projectId);
    if (!project) {
      return { allowed: false, reason: 'project not found' };
    }
    if (!this.shared.has(projectId)) {
      return { allowed: false, reason: 'project is not shared' };
    }
    const role = await this.memberships.getRole(projectId, userId);
    if (!role) {
      return { allowed: false, reason: 'user is not a member' };
    }
    if (intent === 'edit' && !canEdit(role)) {
      return { allowed: false, role, reason: `role ${role} cannot edit` };
    }
    return { allowed: true, role };
  }
}
