/**
 * @lumen/app-telemetry — local-only product telemetry for the Lumen Builder.
 *
 * Privacy-first design:
 *   - Opt-in: nothing is recorded until setEnabled(true) (default: disabled).
 *   - Local-only: sinks write to memory or localStorage; there are ZERO
 *     network calls anywhere in this package.
 *   - Sanitization: prop keys matching /password|token|secret|email/i are
 *     stripped, values are coerced to primitives, and long strings are
 *     truncated.
 *   - Never throws: all sink errors are swallowed into an internal error
 *     counter exposed via stats().
 */

export type TelemetryPropValue = string | number | boolean;

export interface TelemetryEvent {
  /** Unique id, generated per event via the injectable rng. */
  id: string;
  /** Dot-namespaced event name, e.g. 'builder.project.created'. */
  name: string;
  /** Unix epoch milliseconds at the time of track(). */
  ts: number;
  /** Sanitized primitive props (keys may be stripped by the guardrails). */
  props?: Record<string, TelemetryPropValue>;
  /** Per-client-instance session id. */
  sessionId: string;
}

export interface TelemetryQueryFilter {
  /** Match events whose name starts with this prefix (e.g. 'builder.'). */
  namePrefix?: string;
  /** Inclusive lower bound on ts. */
  from?: number;
  /** Inclusive upper bound on ts. */
  to?: number;
}

export interface TelemetryStats {
  /** Total events successfully recorded (post-eviction attempts included). */
  recorded: number;
  /** Events currently retained by the sink. */
  retained: number;
  /** Events evicted by ring-buffer overflow. */
  evicted: number;
  /** Sink errors swallowed by the client. */
  sinkErrors: number;
  /** Whether the client is currently recording. */
  enabled: boolean;
  /** Configured ring-buffer capacity. */
  maxEvents: number;
}

/** Pluggable persistence for telemetry events. Local-only implementations. */
export interface TelemetrySink {
  append(event: TelemetryEvent): void;
  query(filter?: TelemetryQueryFilter): TelemetryEvent[];
  exportAll(): TelemetryEvent[];
  clear(): void;
  size(): number;
}

export interface TelemetryClientOptions {
  /** Opt-in gate; default false — nothing is recorded while disabled. */
  enabled?: boolean;
  /** Ring-buffer capacity; default 500. */
  maxEvents?: number;
  /** Sink implementation; default MemorySink. */
  sink?: TelemetrySink;
  /** Injectable rng (0..1) for id/session generation (test determinism). */
  rng?: () => number;
  /** Injectable clock returning epoch ms (test determinism). */
  clock?: () => number;
}

const DEFAULT_MAX_EVENTS = 500;
const MAX_PROP_STRING_LENGTH = 200;
const FORBIDDEN_KEY_RE = /password|token|secret|email/i;

function defaultRng(): number {
  return Math.random();
}

function defaultClock(): number {
  return Date.now();
}

function idFrom(rng: () => number): string {
  // Two 32-bit-ish random chunks -> 16 hex chars; fine for local dedup/debug.
  const a = Math.floor(rng() * 0xffffffff).toString(16).padStart(8, '0');
  const b = Math.floor(rng() * 0xffffffff).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

/** Coerce an arbitrary prop value to a primitive, or drop it (undefined). */
export function sanitizePropValue(value: unknown): TelemetryPropValue | undefined {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value as number) || typeof value === 'boolean'
      ? (value as TelemetryPropValue)
      : undefined;
  }
  if (typeof value === 'string') {
    return value.length > MAX_PROP_STRING_LENGTH
      ? value.slice(0, MAX_PROP_STRING_LENGTH)
      : value;
  }
  if (value == null) return undefined;
  // Coerce objects/dates/bigints to a truncated string rather than dropping.
  try {
    const s = String(value);
    return s.length > MAX_PROP_STRING_LENGTH ? s.slice(0, MAX_PROP_STRING_LENGTH) : s;
  } catch {
    return undefined;
  }
}

/** Strip forbidden keys and coerce values; never throws. */
export function sanitizeProps(
  props: Record<string, unknown> | undefined,
): Record<string, TelemetryPropValue> | undefined {
  if (!props) return undefined;
  const out: Record<string, TelemetryPropValue> = {};
  for (const [key, raw] of Object.entries(props)) {
    if (FORBIDDEN_KEY_RE.test(key)) continue;
    const value = sanitizePropValue(raw);
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function matchesFilter(event: TelemetryEvent, filter?: TelemetryQueryFilter): boolean {
  if (!filter) return true;
  if (filter.namePrefix !== undefined && !event.name.startsWith(filter.namePrefix)) return false;
  if (filter.from !== undefined && event.ts < filter.from) return false;
  if (filter.to !== undefined && event.ts > filter.to) return false;
  return true;
}

/** In-memory ring-buffer sink (default). */
export class MemorySink implements TelemetrySink {
  #events: TelemetryEvent[] = [];
  #maxEvents: number;
  /** Total evictions due to overflow. */
  evictedCount = 0;

  constructor(maxEvents: number = DEFAULT_MAX_EVENTS) {
    this.#maxEvents = Math.max(1, Math.floor(maxEvents));
  }

  append(event: TelemetryEvent): void {
    this.#events.push(event);
    while (this.#events.length > this.#maxEvents) {
      this.#events.shift();
      this.#evicted();
    }
  }

  #evicted(): void {
    this.evictedCount++;
  }

  query(filter?: TelemetryQueryFilter): TelemetryEvent[] {
    return this.#events.filter((e) => matchesFilter(e, filter));
  }

  exportAll(): TelemetryEvent[] {
    return [...this.#events];
  }

  clear(): void {
    this.#events = [];
  }

  size(): number {
    return this.#events.length;
  }
}

export const LOCALSTORAGE_KEY = 'lumen.telemetry.v1';

/**
 * localStorage-backed sink for the Builder. Guarded for non-browser
 * environments: when localStorage is unavailable, reads return empty and
 * writes throw (which the client swallows into stats().sinkErrors).
 */
export class LocalStorageSink implements TelemetrySink {
  #key: string;
  #maxEvents: number;

  constructor(maxEvents: number = DEFAULT_MAX_EVENTS, key: string = LOCALSTORAGE_KEY) {
    this.#maxEvents = Math.max(1, Math.floor(maxEvents));
    this.#key = key;
  }

  #storage(): Storage {
    if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
      throw new Error('LocalStorageSink: localStorage unavailable (non-browser)');
    }
    return globalThis.localStorage;
  }

  #read(): TelemetryEvent[] {
    const raw = this.#storage().getItem(this.#key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TelemetryEvent[]) : [];
  }

  #write(events: TelemetryEvent[]): void {
    this.#storage().setItem(this.#key, JSON.stringify(events));
  }

  append(event: TelemetryEvent): void {
    const events = this.#read();
    events.push(event);
    while (events.length > this.#maxEvents) events.shift();
    this.#write(events);
  }

  query(filter?: TelemetryQueryFilter): TelemetryEvent[] {
    return this.#read().filter((e) => matchesFilter(e, filter));
  }

  exportAll(): TelemetryEvent[] {
    return this.#read();
  }

  clear(): void {
    this.#storage().removeItem(this.#key);
  }

  size(): number {
    return this.#read().length;
  }
}

export class TelemetryClient {
  #enabled: boolean;
  #maxEvents: number;
  #sink: TelemetrySink;
  #rng: () => number;
  #clock: () => number;
  #sessionId: string;
  #recorded = 0;
  #sinkErrors = 0;

  constructor(options: TelemetryClientOptions = {}) {
    this.#enabled = options.enabled ?? false;
    this.#maxEvents = Math.max(1, Math.floor(options.maxEvents ?? DEFAULT_MAX_EVENTS));
    this.#sink = options.sink ?? new MemorySink(this.#maxEvents);
    this.#rng = options.rng ?? defaultRng;
    this.#clock = options.clock ?? defaultClock;
    this.#sessionId = idFrom(this.#rng);
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = Boolean(enabled);
  }

  /** Record an event. No-op when disabled. Never throws. */
  track(name: string, props?: Record<string, unknown>): void {
    if (!this.#enabled) return;
    try {
      const event: TelemetryEvent = {
        id: idFrom(this.#rng),
        name,
        ts: this.#clock(),
        props: sanitizeProps(props),
        sessionId: this.#sessionId,
      };
      this.#sink.append(event);
      this.#recorded++;
    } catch {
      // All sink/rng/clock errors are swallowed and counted.
      this.#sinkErrors++;
    }
  }

  /** Drain hook — sinks are synchronous/local, so this is a safe no-op boundary. */
  flush(): void {
    try {
      // Sinks persist synchronously; flush exists as a stable API boundary
      // for future buffered sinks. Kept intentionally minimal and safe.
    } catch {
      this.#sinkErrors++;
    }
  }

  query(filter?: TelemetryQueryFilter): TelemetryEvent[] {
    try {
      return this.#sink.query(filter);
    } catch {
      this.#sinkErrors++;
      return [];
    }
  }

  /** Export all retained events as a JSON string. */
  exportEvents(): string {
    try {
      return JSON.stringify(this.#sink.exportAll());
    } catch {
      this.#sinkErrors++;
      return '[]';
    }
  }

  clear(): void {
    try {
      this.#sink.clear();
    } catch {
      this.#sinkErrors++;
    }
  }

  stats(): TelemetryStats {
    let retained = 0;
    try {
      retained = this.#sink.size();
    } catch {
      this.#sinkErrors++;
    }
    const evicted =
      this.#sink instanceof MemorySink
        ? this.#sink.evictedCount
        : Math.max(0, this.#recorded - retained);
    return {
      recorded: this.#recorded,
      retained,
      evicted,
      sinkErrors: this.#sinkErrors,
      enabled: this.#enabled,
      maxEvents: this.#maxEvents,
    };
  }
}

export function createTelemetryClient(options?: TelemetryClientOptions): TelemetryClient {
  return new TelemetryClient(options);
}
