/**
 * @lumen/app-community — threaded comments (local-only).
 *
 * Threaded comments on showcase entries (templates and projects). Comments
 * support one-author edit (records editedAt), soft-delete tombstones, and a
 * per-target cap. list() returns a nested tree in chronological order.
 */

import { defaultCommunityStorage, readJson, writeJson, type StorageLike } from './storage.js';

const COMMENTS_KEY = 'lumen.community.comments.v1';

/** Minimum/maximum comment text length (after trimming). */
export const COMMENT_MIN_LENGTH = 1;
export const COMMENT_MAX_LENGTH = 1000;
/** Maximum comments (including tombstones) per target. */
export const COMMENTS_PER_TARGET_CAP = 500;

/** A stored comment. Deleted comments remain as tombstones. */
export interface Comment {
  id: string;
  /** Showcase entry id this comment is attached to (template or project). */
  targetId: string;
  /** Author profile userId. */
  authorId: string;
  /** Comment text ('' after soft-delete). */
  text: string;
  /** Parent comment id for threaded replies. */
  parentId?: string;
  createdAt: string;
  /** Set when edited (edit keeps the original createdAt). */
  editedAt?: string;
  /** Soft-delete tombstone flag. */
  deleted?: boolean;
}

/** Nested comment node returned by {@link CommentService.list}. */
export interface CommentNode extends Comment {
  children: CommentNode[];
}

/** Thrown on comment validation/ownership failures. */
export class CommentError extends Error {}

const defaultId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export interface CommentServiceOptions {
  storage?: StorageLike;
  now?: () => number;
  generateId?: () => string;
}

/** CommentService — threaded, ownership-checked, capped, local comments. */
export class CommentService {
  private readonly storage: StorageLike;
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(options: CommentServiceOptions = {}) {
    this.storage = options.storage ?? defaultCommunityStorage();
    this.now = options.now ?? (() => Date.now());
    this.generateId = options.generateId ?? defaultId;
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private loadAll(): Comment[] {
    return readJson<Comment[]>(this.storage, COMMENTS_KEY, []);
  }

  private saveAll(comments: Comment[]): void {
    writeJson(this.storage, COMMENTS_KEY, comments);
  }

  private validateText(text: string, op: string): string {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (trimmed.length < COMMENT_MIN_LENGTH || trimmed.length > COMMENT_MAX_LENGTH) {
      throw new CommentError(
        `${op}: text must be ${COMMENT_MIN_LENGTH}-${COMMENT_MAX_LENGTH} characters`,
      );
    }
    return trimmed;
  }

  /** Add a comment (or reply when parentId is given) to a target. */
  add(targetId: string, authorId: string, text: string, parentId?: string): Comment {
    if (!targetId) throw new CommentError('add: targetId is required');
    if (!authorId) throw new CommentError('add: authorId is required');
    const trimmed = this.validateText(text, 'add');
    const comments = this.loadAll();
    const targetCount = comments.filter((c) => c.targetId === targetId).length;
    if (targetCount >= COMMENTS_PER_TARGET_CAP) {
      throw new CommentError(
        `add: target comment cap reached (${COMMENTS_PER_TARGET_CAP} per target)`,
      );
    }
    if (parentId !== undefined) {
      const parent = comments.find((c) => c.id === parentId);
      if (!parent || parent.targetId !== targetId) {
        throw new CommentError(`add: parent comment not found on this target: ${parentId}`);
      }
      if (parent.deleted) {
        throw new CommentError('add: cannot reply to a deleted comment');
      }
    }
    const comment: Comment = {
      id: this.generateId(),
      targetId,
      authorId,
      text: trimmed,
      ...(parentId !== undefined ? { parentId } : {}),
      createdAt: this.iso(),
    };
    comments.push(comment);
    this.saveAll(comments);
    return { ...comment };
  }

  /** Edit a comment's text — author only; sets editedAt. */
  edit(commentId: string, authorId: string, text: string): Comment {
    const trimmed = this.validateText(text, 'edit');
    const comments = this.loadAll();
    const comment = comments.find((c) => c.id === commentId);
    if (!comment) throw new CommentError(`edit: comment not found: ${commentId}`);
    if (comment.authorId !== authorId) {
      throw new CommentError('edit: only the author can edit a comment');
    }
    if (comment.deleted) throw new CommentError('edit: cannot edit a deleted comment');
    comment.text = trimmed;
    comment.editedAt = this.iso();
    this.saveAll(comments);
    return { ...comment };
  }

  /** Soft-delete a comment — author only; leaves a tombstone. */
  delete(commentId: string, authorId: string): Comment {
    const comments = this.loadAll();
    const comment = comments.find((c) => c.id === commentId);
    if (!comment) throw new CommentError(`delete: comment not found: ${commentId}`);
    if (comment.authorId !== authorId) {
      throw new CommentError('delete: only the author can delete a comment');
    }
    comment.text = '';
    comment.deleted = true;
    this.saveAll(comments);
    return { ...comment };
  }

  /**
   * List a target's comments as a nested tree. Roots and children are sorted
   * chronologically (createdAt, then id); deleted comments appear as
   * tombstones so threads keep their shape.
   */
  list(targetId: string): CommentNode[] {
    const comments = this.loadAll().filter((c) => c.targetId === targetId);
    const byTime = (a: Comment, b: Comment): number =>
      a.createdAt < b.createdAt
        ? -1
        : a.createdAt > b.createdAt
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0;
    const nodes = new Map<string, CommentNode>();
    for (const c of comments) nodes.set(c.id, { ...c, children: [] });
    const roots: CommentNode[] = [];
    for (const c of [...comments].sort(byTime)) {
      const node = nodes.get(c.id) as CommentNode;
      if (c.parentId !== undefined && nodes.has(c.parentId)) {
        (nodes.get(c.parentId) as CommentNode).children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  /** Number of comments (including tombstones) on a target. */
  count(targetId: string): number {
    return this.loadAll().filter((c) => c.targetId === targetId).length;
  }
}
