/**
 * @lumen/app-designer — UndoStack.
 *
 * Snapshot-based undo/redo for designer documents. Snapshots are deep-cloned
 * on push so later mutation of the live document never corrupts history.
 * Capped (default 100 entries); pushing past the cap drops the oldest entry.
 */

export interface UndoStackOptions {
  /** Maximum retained snapshots (default 100). */
  cap?: number;
}

export class UndoStack<T> {
  private readonly cap: number;
  private past: T[] = [];
  private future: T[] = [];

  constructor(options: UndoStackOptions = {}) {
    this.cap = Math.max(1, options.cap ?? 100);
  }

  /** Number of undo steps available. */
  get undoDepth(): number {
    return this.past.length;
  }

  /** Number of redo steps available. */
  get redoDepth(): number {
    return this.future.length;
  }

  /** Push a new snapshot (clears the redo lane). The snapshot is deep-cloned. */
  push(snapshot: T): void {
    this.past.push(clone(snapshot));
    if (this.past.length > this.cap) this.past.shift();
    this.future = [];
  }

  /**
   * Undo one step: returns the snapshot to restore, or undefined when empty.
   * `current` is the live document state (pushed onto the redo lane).
   */
  undo(current: T): T | undefined {
    const snapshot = this.past.pop();
    if (snapshot === undefined) return undefined;
    this.future.push(clone(current));
    return clone(snapshot);
  }

  /**
   * Redo one step: returns the snapshot to restore, or undefined when empty.
   * `current` is the live document state (pushed back onto the undo lane).
   */
  redo(current: T): T | undefined {
    const snapshot = this.future.pop();
    if (snapshot === undefined) return undefined;
    this.past.push(clone(current));
    if (this.past.length > this.cap) this.past.shift();
    return clone(snapshot);
  }

  /** Drop all history. */
  clear(): void {
    this.past = [];
    this.future = [];
  }
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
