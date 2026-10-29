/**
 * HostedTelemetry — opt-in gated inserts into `telemetry_events`.
 * DEFAULT IS OFF: nothing leaves the client until setEnabled(true)
 * (mirrors @lumen/app-telemetry's privacy-first stance; hosted mode just
 * swaps the local sink for the telemetry_events table, which is
 * user-insert/select-own under RLS).
 */
import type { SupabaseClientLike } from './client.js';
import { unwrapRows } from './client.js';

export type HostedTelemetryProps = Record<string, string | number | boolean>;

export interface HostedTelemetryOptions {
  /** Opt-in gate; default false. */
  enabled?: boolean;
  userId?: () => Promise<string | undefined>;
  /** Injectable session id (defaults to a random one per instance). */
  sessionId?: string;
}

export class HostedTelemetry {
  private readonly client: SupabaseClientLike;
  private enabled: boolean;
  private readonly sessionId: string;
  private readonly resolveUserId: () => Promise<string | undefined>;

  constructor(client: SupabaseClientLike, options: HostedTelemetryOptions = {}) {
    this.client = client;
    this.enabled = options.enabled ?? false;
    this.sessionId = options.sessionId ?? defaultSessionId();
    this.resolveUserId =
      options.userId ??
      (async () => (await this.client.auth.getUser()).data?.id ?? undefined);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** No-op unless opted in. Never throws (telemetry must not break flows). */
  async track(name: string, props: HostedTelemetryProps = {}): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const userId = await this.resolveUserId();
      if (!userId) return false;
      await unwrapRows(
        this.client
          .from('telemetry_events')
          .insert({ user_id: userId, name, props, session_id: this.sessionId })
          .select(),
        'telemetry.track',
      );
      return true;
    } catch {
      return false;
    }
  }
}

function defaultSessionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
