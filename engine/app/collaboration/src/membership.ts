import type { Member, Role } from './types.js';

export interface MembershipStoreOptions {
  /** Injectable clock returning epoch millis (for tests). */
  now?: () => number;
}

/**
 * Membership persistence seam: projectId -> members. All methods are async
 * for adapter parity (memory now, browser localStorage in the builder).
 */
export interface MembershipStore {
  listMembers(projectId: string): Promise<Member[]>;
  addMember(projectId: string, userId: string, role: Role): Promise<Member>;
  removeMember(projectId: string, userId: string): Promise<boolean>;
  setRole(projectId: string, userId: string, role: Role): Promise<Member>;
  getRole(projectId: string, userId: string): Promise<Role | undefined>;
  /** All project ids the user is a member of. */
  projectsFor(userId: string): Promise<string[]>;
}

abstract class BaseMembershipStore implements MembershipStore {
  protected readonly now: () => number;

  constructor(options: MembershipStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  protected abstract readAll(): Promise<Map<string, Member[]>>;
  protected abstract writeAll(all: Map<string, Member[]>): Promise<void>;

  async listMembers(projectId: string): Promise<Member[]> {
    const all = await this.readAll();
    return (all.get(projectId) ?? []).map((m) => ({ ...m }));
  }

  async addMember(projectId: string, userId: string, role: Role): Promise<Member> {
    const all = await this.readAll();
    const members = all.get(projectId) ?? [];
    const existing = members.find((m) => m.userId === userId);
    if (existing) {
      existing.role = role;
      await this.writeAll(all);
      return { ...existing };
    }
    const member: Member = { userId, role, addedAt: this.now() };
    members.push(member);
    all.set(projectId, members);
    await this.writeAll(all);
    return { ...member };
  }

  async removeMember(projectId: string, userId: string): Promise<boolean> {
    const all = await this.readAll();
    const members = all.get(projectId) ?? [];
    const idx = members.findIndex((m) => m.userId === userId);
    if (idx < 0) return false;
    members.splice(idx, 1);
    all.set(projectId, members);
    await this.writeAll(all);
    return true;
  }

  async setRole(projectId: string, userId: string, role: Role): Promise<Member> {
    const all = await this.readAll();
    const member = (all.get(projectId) ?? []).find((m) => m.userId === userId);
    if (!member) {
      throw new Error(`setRole: no membership for user ${userId} in project ${projectId}`);
    }
    member.role = role;
    await this.writeAll(all);
    return { ...member };
  }

  async getRole(projectId: string, userId: string): Promise<Role | undefined> {
    const all = await this.readAll();
    return (all.get(projectId) ?? []).find((m) => m.userId === userId)?.role;
  }

  async projectsFor(userId: string): Promise<string[]> {
    const all = await this.readAll();
    const out: string[] = [];
    for (const [projectId, members] of all) {
      if (members.some((m) => m.userId === userId)) out.push(projectId);
    }
    return out;
  }
}

/** In-memory membership store (default; used by tests and headless runs). */
export class MemoryMembershipStore extends BaseMembershipStore {
  private readonly data = new Map<string, Member[]>();

  protected async readAll(): Promise<Map<string, Member[]>> {
    return new Map([...this.data].map(([k, v]) => [k, v.map((m) => ({ ...m }))]));
  }

  protected async writeAll(all: Map<string, Member[]>): Promise<void> {
    this.data.clear();
    for (const [k, v] of all) this.data.set(k, v.map((m) => ({ ...m })));
  }
}

const STORAGE_KEY = 'lumen.collaboration.v1.memberships';

/**
 * Browser localStorage adapter. Guards for non-browser environments: any
 * operation without a usable localStorage throws a descriptive error, and
 * `isAvailable()` lets callers pick MemoryMembershipStore instead.
 */
export class LocalStorageMembershipStore extends BaseMembershipStore {
  static isAvailable(): boolean {
    try {
      return typeof localStorage !== 'undefined' && localStorage !== null;
    } catch {
      return false;
    }
  }

  private store(): Storage {
    if (!LocalStorageMembershipStore.isAvailable()) {
      throw new Error(
        'LocalStorageMembershipStore: localStorage is not available in this environment; use MemoryMembershipStore instead.',
      );
    }
    return localStorage;
  }

  protected async readAll(): Promise<Map<string, Member[]>> {
    const raw = this.store().getItem(STORAGE_KEY);
    if (raw === null) return new Map();
    const entries = JSON.parse(raw) as [string, Member[]][];
    return new Map(entries.map(([k, v]) => [k, v.map((m) => ({ ...m }))]));
  }

  protected async writeAll(all: Map<string, Member[]>): Promise<void> {
    this.store().setItem(STORAGE_KEY, JSON.stringify([...all.entries()]));
  }
}
