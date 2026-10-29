/**
 * Supabase client factories.
 *
 * - serviceClient(): bypasses RLS. Used for privileged writes (publishes,
 *   asset updates, payouts) after the caller has been authorized explicitly.
 * - anonClient(jwt): scoped to the caller's JWT. Used to resolve the user
 *   and to run membership/ownership reads under RLS as the caller.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** Legacy service_role JWT: platform injects it as SERVICE_ROLE_KEY; the
 *  SUPABASE_SERVICE_ROLE_KEY name now carries the new sb_secret_ key, which
 *  does NOT bypass RLS. Prefer the legacy JWT. */
export function serviceRoleKey(): string {
  return Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = serviceRoleKey();
  if (!url || !key) throw new Error('SUPABASE_URL / service-role key not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function anonClient(jwt: string): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? serviceRoleKey();
  if (!url || !anonKey) throw new Error('SUPABASE_URL / anon key not configured');
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
