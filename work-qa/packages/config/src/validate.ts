/**
 * @lumen/config — minimal, zero-dependency validator toolkit.
 *
 * Composable validators producing either a typed value or a list of
 * path-aware validation errors. All combinators accumulate errors instead
 * of failing fast, so a single `validate` pass reports every problem.
 */

/** A single validation failure with a precise JSON path (RFC 6901-ish, dot/bracket). */
export interface ValidationError {
  /** Dot/bracket path into the input, e.g. `scenes[0].track.driver`. Empty string = root. */
  path: string;
  /** Human-readable failure message. */
  message: string;
}

/** Result of running a validator. */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

/** A validator: unknown input + current path → typed value or errors. */
export interface Validator<T> {
  (input: unknown, path: string): ValidationResult<T>;
}

const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const fail = <T>(path: string, message: string): ValidationResult<T> => ({
  ok: false,
  errors: [{ path, message }],
});

/** Join a child key/index onto a parent path. */
export function joinPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return parent === '' ? key : `${parent}.${key}`;
  return `${parent}[${JSON.stringify(key)}]`;
}

/** Type guard helper: plain, non-null, non-array object. */
export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/** Validates a string. */
export function string(opts: { minLength?: number; nonEmpty?: boolean } = {}): Validator<string> {
  return (input, path) => {
    if (typeof input !== 'string') return fail(path, `expected string, got ${describe(input)}`);
    if ((opts.nonEmpty || (opts.minLength ?? 0) > 0) && input.length < Math.max(opts.minLength ?? 0, 1)) {
      return fail(path, `expected non-empty string`);
    }
    if (opts.minLength !== undefined && input.length < opts.minLength) {
      return fail(path, `expected string of length >= ${opts.minLength}`);
    }
    return ok(input);
  };
}

/** Validates a number. */
export function number(opts: { min?: number; int?: boolean } = {}): Validator<number> {
  return (input, path) => {
    if (typeof input !== 'number' || Number.isNaN(input)) {
      return fail(path, `expected number, got ${describe(input)}`);
    }
    if (opts.int && !Number.isInteger(input)) return fail(path, `expected integer, got ${input}`);
    if (opts.min !== undefined && input < opts.min) return fail(path, `expected number >= ${opts.min}, got ${input}`);
    return ok(input);
  };
}

/** Validates a boolean. */
export function boolean(): Validator<boolean> {
  return (input, path) =>
    typeof input === 'boolean' ? ok(input) : fail(path, `expected boolean, got ${describe(input)}`);
}

/** Validates a string enum (literal union). */
export function enumOf<T extends string>(values: readonly T[]): Validator<T> {
  return (input, path) =>
    typeof input === 'string' && (values as readonly string[]).includes(input)
      ? ok(input as T)
      : fail(path, `expected one of ${values.map((v) => JSON.stringify(v)).join(', ')}, got ${JSON.stringify(input)}`);
}

/** Validates an array with a per-element validator. */
export function array<T>(element: Validator<T>): Validator<T[]> {
  return (input, path) => {
    if (!Array.isArray(input)) return fail(path, `expected array, got ${describe(input)}`);
    const value: T[] = new Array(input.length);
    const errors: ValidationError[] = [];
    for (let i = 0; i < input.length; i++) {
      const r = element(input[i], joinPath(path, i));
      if (r.ok) value[i] = r.value;
      else errors.push(...r.errors);
    }
    return errors.length === 0 ? ok(value) : { ok: false, errors };
  };
}

/** Makes a validator optional: `undefined` passes through as `undefined`. */
export function optional<T>(inner: Validator<T>): Validator<T | undefined> {
  return (input, path) => (input === undefined ? ok(undefined) : inner(input, path));
}

/** First-match union: returns the first variant that validates, else merged errors. */
export function union<T>(variants: readonly Validator<T>[], label?: string): Validator<T> {
  return (input, path) => {
    let best: ValidationError[] | null = null;
    for (const variant of variants) {
      const r = variant(input, path);
      if (r.ok) return r;
      if (best === null || r.errors.length < best.length) best = r.errors;
    }
    return {
      ok: false,
      errors: [{ path, message: `did not match any variant${label ? ` of ${label}` : ''}` }, ...(best ?? [])],
    };
  };
}

/** Validates a string-keyed record of values. */
export function recordOf<T>(valueValidator: Validator<T>): Validator<Record<string, T>> {
  return (input, path) => {
    if (!isRecord(input)) return fail(path, `expected object, got ${describe(input)}`);
    const value: Record<string, T> = {};
    const errors: ValidationError[] = [];
    for (const [k, v] of Object.entries(input)) {
      const r = valueValidator(v, joinPath(path, k));
      if (r.ok) value[k] = r.value;
      else errors.push(...r.errors);
    }
    return errors.length === 0 ? ok(value) : { ok: false, errors };
  };
}

/** Validates a fixed-length tuple of numbers (e.g. inputRange, bezier curves). */
export function tuple<T extends readonly unknown[]>(...items: { [K in keyof T]: Validator<T[K]> }): Validator<T> {
  return (input, path) => {
    if (!Array.isArray(input)) return fail(path, `expected array of length ${items.length}, got ${describe(input)}`);
    if (input.length !== items.length) {
      return fail(path, `expected array of length ${items.length}, got length ${input.length}`);
    }
    const value: unknown[] = new Array(items.length);
    const errors: ValidationError[] = [];
    for (let i = 0; i < items.length; i++) {
      const r = items[i](input[i], joinPath(path, i));
      if (r.ok) value[i] = r.value;
      else errors.push(...r.errors);
    }
    return errors.length === 0 ? ok(value as unknown as T) : { ok: false, errors };
  };
}

/** Field spec for `object()`: required or optional validator per key. */
export type ObjectSpec = Record<string, Validator<unknown>>;

/** Infers the object type produced by an `object()` spec. */
export type InferObject<S extends ObjectSpec> = {
  [K in keyof S]: S[K] extends Validator<infer T> ? T : never;
};

/**
 * Validates a plain object against a field spec. Unknown keys are rejected
 * (strict) to surface typos in authored configs; missing required keys and
 * invalid values are all reported with full paths.
 */
export function object<S extends ObjectSpec>(spec: S): Validator<InferObject<S>> {
  return (input, path) => {
    if (!isRecord(input)) return fail(path, `expected object, got ${describe(input)}`);
    const value: Record<string, unknown> = {};
    const errors: ValidationError[] = [];
    for (const [key, fieldValidator] of Object.entries(spec)) {
      const fieldPath = joinPath(path, key);
      const raw = input[key];
      if (raw === undefined && !(key in input)) {
        // Distinguish optional fields: probe with undefined.
        const probe = fieldValidator(undefined, fieldPath);
        if (probe.ok) {
          // Optional field absent: omit the key entirely so downstream
          // spreads/defaults are not clobbered by an explicit `undefined`.
          if (probe.value !== undefined) value[key] = probe.value;
          continue;
        }
        errors.push({ path: fieldPath, message: 'missing required field' });
        continue;
      }
      const r = fieldValidator(raw, fieldPath);
      if (r.ok) value[key] = r.value;
      else errors.push(...r.errors);
    }
    for (const key of Object.keys(input)) {
      if (!(key in spec)) errors.push({ path: joinPath(path, key), message: 'unknown field' });
    }
    return errors.length === 0 ? ok(value as InferObject<S>) : { ok: false, errors };
  };
}

/** Short human description of a runtime value for error messages. */
function describe(input: unknown): string {
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'array';
  return typeof input === 'string' ? JSON.stringify(input) : typeof input;
}
