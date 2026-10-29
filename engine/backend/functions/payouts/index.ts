/**
 * payouts — POST, cron-invoked (pg_cron `settle_payouts`, daily 03:00).
 *
 * Auth: shared cron secret via `x-cron-secret` header (env CRON_SECRET), or
 * the service-role key as a bearer token (supersedes the secret).
 *
 * Behavior:
 *  1. Select unsettled revenue_ledger rows (settled = false).
 *  2. Group by author_id, summing creator_cents (the 70% creator share
 *     written by the purchases_after_insert trigger).
 *  3. For authors meeting the threshold (PAYOUT_THRESHOLD_CENTS, default
 *     2500 = $25), insert a payouts row { author_id, amount_cents,
 *     status: 'scheduled', period_start, period_end } and mark those ledger
 *     rows settled.
 *  4. Return summary { authors, total_cents, payouts: [...] }.
 */

import { isPreflight, preflightResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { err, json } from '../_shared/responses.ts';

interface LedgerRow {
  id: number;
  author_id: string;
  creator_cents: number;
  created_at: string;
}

import { keysEqual } from '../_shared/auth.ts';
import { serviceRoleKey } from '../_shared/supabase.ts';

function requireCronAuth(req: Request): boolean {
  const secret = req.headers.get('x-cron-secret') ?? '';
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  if (cronSecret && keysEqual(secret, cronSecret)) return true;
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const serviceKey = serviceRoleKey();
  return keysEqual(bearer, serviceKey);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (isPreflight(req)) return preflightResponse(req);
  if (req.method !== 'POST') return err(req, 405, 'Method not allowed');
  if (!requireCronAuth(req)) return err(req, 401, 'Invalid cron secret');

  const threshold = parseInt(Deno.env.get('PAYOUT_THRESHOLD_CENTS') ?? '2500', 10);
  const db = serviceClient();

  const { data: rows, error: selErr } = await db
    .from('revenue_ledger')
    .select('id, author_id, creator_cents, created_at')
    .eq('settled', false)
    .order('created_at', { ascending: true });
  if (selErr) return err(req, 500, 'revenue_ledger read failed', selErr.message);

  const ledger = (rows ?? []) as LedgerRow[];
  if (ledger.length === 0) {
    return json(req, { authors: 0, total_cents: 0, payouts: [] });
  }

  // Group by author.
  const byAuthor = new Map<string, { cents: number; ids: number[]; min: string; max: string }>();
  for (const r of ledger) {
    const g = byAuthor.get(r.author_id) ?? { cents: 0, ids: [], min: r.created_at, max: r.created_at };
    g.cents += r.creator_cents;
    g.ids.push(r.id);
    if (r.created_at < g.min) g.min = r.created_at;
    if (r.created_at > g.max) g.max = r.created_at;
    byAuthor.set(r.author_id, g);
  }

  const periodEnd = new Date().toISOString();
  const payouts: Array<{ author_id: string; amount_cents: number; payout_id: string }> = [];
  const skipped: Array<{ author_id: string; amount_cents: number; reason: string }> = [];
  let totalCents = 0;

  for (const [authorId, g] of byAuthor) {
    if (g.cents < threshold) {
      skipped.push({ author_id: authorId, amount_cents: g.cents, reason: 'below_threshold' });
      continue;
    }
    const { data: payout, error: insErr } = await db
      .from('payouts')
      .insert({
        author_id: authorId,
        amount_cents: g.cents,
        status: 'scheduled',
        period_start: g.min,
        period_end: periodEnd,
      })
      .select('id')
      .single();
    if (insErr) return err(req, 500, `payouts insert failed for ${authorId}`, insErr.message);

    const { error: updErr } = await db
      .from('revenue_ledger')
      .update({ settled: true })
      .in('id', g.ids);
    if (updErr) {
      return err(req, 500, `revenue_ledger settle failed for ${authorId}`, updErr.message);
    }
    payouts.push({ author_id: authorId, amount_cents: g.cents, payout_id: payout.id });
    totalCents += g.cents;
  }

  return json(req, { authors: payouts.length, total_cents: totalCents, payouts, skipped });
});
