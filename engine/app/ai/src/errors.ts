/**
 * @lumen/app-ai — error types.
 */

/** Validation problem carried by {@link AIGenerationError}. */
export interface AIGenerationIssue {
  /** JSON path into the generated config ('' for top-level problems). */
  path: string;
  /** Human-readable message. */
  message: string;
}

/**
 * Thrown when AI-assisted generation produces a config that fails the
 * `@lumen/config` parseConfig gate, or when generation cannot proceed
 * (e.g. empty description after normalization).
 */
export class AIGenerationError extends Error {
  readonly name = 'AIGenerationError';
  /** Machine-stable reason code. */
  readonly code: 'empty-description' | 'validation-failed' | 'provider-failed';
  /** Validation issues reported by parseConfig (when applicable). */
  readonly issues: AIGenerationIssue[];

  constructor(code: AIGenerationError['code'], message: string, issues: AIGenerationIssue[] = []) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}
