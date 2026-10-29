import type { Invitation, Role } from './types.js';
import type { MembershipStore } from './membership.js';

export const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface InvitationServiceOptions {
  /** Injectable clock returning epoch millis (for tests). */
  now?: () => number;
  /** Injectable token generator (defaults to crypto.randomUUID). */
  generateToken?: () => string;
  /** Time-to-live for new invitations (default 7 days). */
  ttlMs?: number;
}

export interface InviteResult {
  token: string;
  acceptUrl: string;
}

/**
 * InvitationService — mock invitations. Tokens and accept URLs are generated
 * locally (`lumen://invite/<token>`); nothing is ever emailed or sent over
 * the network.
 */
export class InvitationService {
  private readonly memberships: MembershipStore;
  private readonly now: () => number;
  private readonly generateToken: () => string;
  private readonly ttlMs: number;
  private readonly invitations = new Map<string, Invitation>();

  constructor(memberships: MembershipStore, options: InvitationServiceOptions = {}) {
    this.memberships = memberships;
    this.now = options.now ?? (() => Date.now());
    this.generateToken =
      options.generateToken ??
      (() => {
        const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
        if (c?.randomUUID) return c.randomUUID();
        return `tok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      });
    this.ttlMs = options.ttlMs ?? DEFAULT_INVITE_TTL_MS;
  }

  /** Create a mock invitation. Returns the token and a lumen:// accept URL. */
  invite(projectId: string, email: string, role: Role): InviteResult {
    if (!email || typeof email !== 'string') {
      throw new Error('invite: email is required');
    }
    const token = this.generateToken();
    const now = this.now();
    this.invitations.set(token, {
      token,
      projectId,
      email,
      role,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      revoked: false,
    });
    return { token, acceptUrl: `lumen://invite/${token}` };
  }

  private usable(token: string): Invitation {
    const inv = this.invitations.get(token);
    if (!inv) throw new Error(`invitation not found: ${token}`);
    if (inv.revoked) throw new Error(`invitation revoked: ${token}`);
    if (this.now() >= inv.expiresAt) throw new Error(`invitation expired: ${token}`);
    return inv;
  }

  /**
   * Accept an invitation: the user becomes a member with the invited role.
   * Throws for unknown, revoked or expired tokens.
   */
  async accept(token: string, userId: string) {
    const inv = this.usable(token);
    return this.memberships.addMember(inv.projectId, userId, inv.role);
  }

  /** Revoke an invitation so it can no longer be accepted. */
  revoke(token: string): boolean {
    const inv = this.invitations.get(token);
    if (!inv) return false;
    inv.revoked = true;
    return true;
  }

  /** Inspect an invitation (state as of now; expiry is not persisted). */
  get(token: string): Invitation | undefined {
    const inv = this.invitations.get(token);
    return inv ? { ...inv } : undefined;
  }
}
