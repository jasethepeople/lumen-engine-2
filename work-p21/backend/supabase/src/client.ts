/**
 * @lumen/backend-supabase — SupabaseClientLike.
 *
 * A structural (duck-typed) subset of the @supabase/supabase-js client. The
 * package deliberately has ZERO runtime dependencies: any object satisfying
 * this interface — the real Supabase client in the browser, or the
 * hand-rolled FakeSupabaseClient in tests — is accepted via constructor
 * injection. Table/column/bucket names come from backend/SCHEMA.md.
 */

/** PostgREST-style error shape (message/code are all the bindings rely on). */
export interface SupabaseErrorLike {
  message: string;
  code?: string;
  details?: string;
}

/** Result envelope shared by PostgREST, rpc, storage and edge invokes. */
export interface SupabaseResult<T> {
  data: T | null;
  error: SupabaseErrorLike | null;
}

/**
 * Chainable PostgREST query builder. Every filter/terminal method returns
 * the builder (or a thenable) so the bindings can compose
 * `from(t).select().eq(...).order(...)` fluently. Awaiting the builder
 * itself executes the query (PostgrestBuilder is thenable in supabase-js).
 */
export interface SupabaseQueryLike extends PromiseLike<SupabaseResult<unknown[]>> {
  select(columns?: string): SupabaseQueryLike;
  insert(values: unknown | unknown[]): SupabaseQueryLike;
  update(values: Record<string, unknown>): SupabaseQueryLike;
  upsert(values: unknown | unknown[], options?: { onConflict?: string }): SupabaseQueryLike;
  delete(): SupabaseQueryLike;
  eq(column: string, value: unknown): SupabaseQueryLike;
  match(query: Record<string, unknown>): SupabaseQueryLike;
  order(column: string, options?: { ascending?: boolean }): SupabaseQueryLike;
  limit(count: number): SupabaseQueryLike;
  /** Terminal: expect exactly one row; error otherwise. */
  single(): PromiseLike<SupabaseResult<unknown>>;
}

export interface SupabaseBucketLike {
  upload(
    path: string,
    body: unknown,
    options?: { contentType?: string; upsert?: boolean },
  ): PromiseLike<SupabaseResult<{ path: string }>>;
  download(path: string): PromiseLike<SupabaseResult<unknown>>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
}

/** Realtime channel handle (presence + postgres_changes subscriptions). */
export interface SupabaseChannelLike {
  on(
    type: 'postgres_changes' | 'presence' | string,
    filter: Record<string, unknown>,
    callback: (payload: unknown) => void,
  ): SupabaseChannelLike;
  track(payload: Record<string, unknown>): PromiseLike<unknown>;
  untrack(): PromiseLike<unknown>;
  subscribe(callback?: (status: string) => void): SupabaseChannelLike;
  unsubscribe(): PromiseLike<unknown>;
}

export interface SupabaseAuthSessionLike {
  user: SupabaseUserLike | null;
}

export interface SupabaseUserLike {
  id: string;
  email?: string;
}

export interface SupabaseAuthLike {
  signUp(credentials: {
    email: string;
    password: string;
  }): PromiseLike<SupabaseResult<{ user: SupabaseUserLike | null }>>;
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): PromiseLike<SupabaseResult<{ user: SupabaseUserLike | null }>>;
  signInWithOtp(credentials: {
    email: string;
    options?: { emailRedirectTo?: string };
  }): PromiseLike<SupabaseResult<unknown>>;
  signOut(): PromiseLike<{ error: SupabaseErrorLike | null }>;
  getUser(): PromiseLike<SupabaseResult<SupabaseUserLike>>;
  onAuthStateChange(
    callback: (event: string, session: SupabaseAuthSessionLike | null) => void,
  ): { data: { subscription: { unsubscribe(): void } } };
}

export interface SupabaseFunctionsLike {
  invoke(
    name: string,
    options?: { body?: unknown },
  ): PromiseLike<SupabaseResult<unknown>>;
}

/** The full structural client surface consumed by the hosted bindings. */
export interface SupabaseClientLike {
  from(table: string): SupabaseQueryLike;
  storage: { from(bucket: string): SupabaseBucketLike };
  channel(name: string): SupabaseChannelLike;
  auth: SupabaseAuthLike;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<SupabaseResult<unknown>>;
  functions: SupabaseFunctionsLike;
}

/** Unwrap a SupabaseResult, throwing on error. */
export async function unwrap<T>(result: PromiseLike<SupabaseResult<unknown>>, context: string): Promise<T> {
  const { data, error } = await result;
  if (error) throw new Error(`${context}: ${error.message}`);
  return data as T;
}

/** Unwrap a rows query (defaults to an empty array). */
export async function unwrapRows<T>(
  query: PromiseLike<SupabaseResult<unknown[]>>,
  context: string,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${context}: ${error.message}`);
  return (data ?? []) as T[];
}
