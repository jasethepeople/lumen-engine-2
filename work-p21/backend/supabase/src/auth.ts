/**
 * Hosted auth binding — thin wrapper over client.auth.* (Supabase Auth).
 * Mirrors the builder-facing auth surface; user ids map to profiles.id.
 */
import type {
  SupabaseClientLike,
  SupabaseUserLike,
} from './client.js';

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface HostedUser {
  id: string;
  email?: string;
}

export type AuthChangeCallback = (
  event: string,
  user: HostedUser | null,
) => void;

function toHosted(user: SupabaseUserLike | null): HostedUser | null {
  if (!user) return null;
  const hosted: HostedUser = { id: user.id };
  if (user.email !== undefined) hosted.email = user.email;
  return hosted;
}

export class HostedAuth {
  private readonly client: SupabaseClientLike;

  constructor(client: SupabaseClientLike) {
    this.client = client;
  }

  async signUp(credentials: AuthCredentials): Promise<HostedUser | null> {
    const { data, error } = await this.client.auth.signUp(credentials);
    if (error) throw new Error(`auth.signUp: ${error.message}`);
    return toHosted(data?.user ?? null);
  }

  async signInWithPassword(credentials: AuthCredentials): Promise<HostedUser | null> {
    const { data, error } = await this.client.auth.signInWithPassword(credentials);
    if (error) throw new Error(`auth.signInWithPassword: ${error.message}`);
    return toHosted(data?.user ?? null);
  }

  /** Magic-link (OTP email) sign-in. */
  async signInWithMagicLink(email: string, emailRedirectTo?: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      ...(emailRedirectTo !== undefined ? { options: { emailRedirectTo } } : {}),
    });
    if (error) throw new Error(`auth.signInWithMagicLink: ${error.message}`);
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw new Error(`auth.signOut: ${error.message}`);
  }

  async getUser(): Promise<HostedUser | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error) throw new Error(`auth.getUser: ${error.message}`);
    return toHosted(data ?? null);
  }

  /** Subscribe to auth state changes; returns an unsubscribe function. */
  onAuthChange(callback: AuthChangeCallback): () => void {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      callback(event, toHosted(session?.user ?? null));
    });
    return () => data.subscription.unsubscribe();
  }
}
