import type { Role } from './types.js';

const RANK: Record<Role, number> = { owner: 3, editor: 2, viewer: 1 };

/** True when the role may modify project config. */
export function canEdit(role: Role): boolean {
  return RANK[role] >= RANK.editor;
}

/** True when the role may share a project with others. */
export function canShare(role: Role): boolean {
  return RANK[role] >= RANK.owner;
}

/** True when the role may add/remove/change members. */
export function canManageMembers(role: Role): boolean {
  return RANK[role] >= RANK.owner;
}
