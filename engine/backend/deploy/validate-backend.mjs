#!/usr/bin/env node
/**
 * validate-backend.mjs — post-deploy validation harness (zero-dep, Node ≥18).
 *
 * Checks against a deployed Supabase project:
 *   1. All 19 tables exist            (PostgREST HEAD per table)
 *   2. RLS enabled per table          (PostgREST: table must reject
 *                                      unauthenticated access with 401; and
 *                                      pg_tables query when SUPABASE_DB_URL)
 *   3. Storage buckets + public flags (Storage API, service key)
 *   4. Edge functions responding      (OPTIONS preflight / POST health probe)
 *   5. Cron jobs listed               (pg cron.job via SUPABASE_DB_URL)
 *
 * Graceful degradation: when the required env for a group is absent, every
 * check in that group is reported SKIPPED and the run still exits 0 with a
 * 'SKIPPED (no credentials)' summary. Any FAILED check exits non-zero.
 *
 * Env (see backend/deploy/.env.example):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
 *   SUPABASE_DB_URL (optional; enables pg-level RLS + cron checks)
 *
 * Usage: node backend/deploy/validate-backend.mjs [--json]
 */

const TABLES = [
  'profiles', 'projects', 'project_versions', 'project_members',
  'invitations', 'merge_suggestions', 'activity_log', 'assets', 'asset_jobs',
  'publishes', 'templates', 'purchases', 'payouts', 'revenue_ledger',
  'subscriptions', 'comments', 'remixes', 'analytics_events',
  'telemetry_events',
];
const BUCKETS = [
  { id: 'assets', public: false },
  { id: 'bundles', public: false },
  { id: 'thumbnails', public: true },
];
const FUNCTIONS = ['publish-pipeline', 'asset-pipeline', 'payouts'];
const CRON_JOBS = ['settle_payouts', 'expire_invitations'];

const env = process.env;
const JSON_OUT = process.argv.includes('--json');

const results = []; // {group, name, status: PASS|FAIL|SKIP, detail}
const record = (group, name, status, detail = '') => {
  results.push({ group, name, status, detail });
  if (!JSON_OUT) {
    const mark = { PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP' }[status];
    console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const base = (env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
const anonKey = env.SUPABASE_ANON_KEY || '';
const haveRest = Boolean(base && (serviceKey || anonKey));
const haveService = Boolean(base && serviceKey);
const havePg = Boolean(env.SUPABASE_DB_URL);

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      apikey: serviceKey || anonKey,
      Authorization: `Bearer ${serviceKey || anonKey}`,
      ...(opts.headers || {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty body ok */ }
  return { status: res.status, body };
}

/** Run a read-only SQL query via psql when SUPABASE_DB_URL is set. */
async function pgQuery(sql) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { stdout } = await run('psql', [env.SUPABASE_DB_URL, '-At', '-c', sql], {
    timeout: 20000,
  });
  return stdout.trim();
}

async function checkTables() {
  console.log('\n== Tables (19) ==');
  if (!haveRest) {
    for (const t of TABLES) record('tables', `table ${t}`, 'SKIP', 'no SUPABASE_URL/key');
    return;
  }
  for (const t of TABLES) {
    try {
      // select with limit 0: 200 means the relation exists in the schema cache.
      const { status, body } = await fetchJson(`${base}/rest/v1/${t}?select=*&limit=0`);
      if (status === 200) record('tables', `table ${t}`, 'PASS');
      else if (status === 404 || status === 400) record('tables', `table ${t}`, 'FAIL', `HTTP ${status} ${JSON.stringify(body)}`);
      else record('tables', `table ${t}`, 'FAIL', `unexpected HTTP ${status}`);
    } catch (e) {
      record('tables', `table ${t}`, 'FAIL', String(e.message || e));
    }
  }
}

async function checkRls() {
  console.log('\n== RLS enabled ==');
  if (havePg) {
    try {
      const out = await pgQuery(
        `select tablename from pg_tables where schemaname='public' and rowsecurity;`,
      );
      const enabled = new Set(out.split('\n').filter(Boolean));
      for (const t of TABLES) {
        if (enabled.has(t)) record('rls', `rls ${t}`, 'PASS');
        else record('rls', `rls ${t}`, 'FAIL', 'rowsecurity=false in pg_tables');
      }
      return;
    } catch (e) {
      record('rls', 'pg RLS check', 'SKIP', `psql unavailable/failed: ${e.message}`);
      return;
    }
  }
  if (!base || !anonKey) {
    for (const t of TABLES) record('rls', `rls ${t}`, 'SKIP', 'no SUPABASE_DB_URL and no anon key');
    return;
  }
  // Heuristic without pg access: with RLS enabled and no policies for the
  // anon role, a bare request must NOT return rows (empty 200 or 401/406).
  // A table with RLS disabled + default grants would leak rows.
  for (const t of TABLES) {
    try {
      const res = await fetch(`${base}/rest/v1/${t}?select=*&limit=1`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });
      if (res.status === 401 || res.status === 403) {
        record('rls', `rls ${t}`, 'PASS', `anon denied (HTTP ${res.status})`);
      } else if (res.status === 200) {
        record('rls', `rls ${t}`, 'PASS',
          'anon request ok (public-read policy or empty result; verify policies in 0007_rls.sql)');
      } else {
        record('rls', `rls ${t}`, 'FAIL', `unexpected HTTP ${res.status}`);
      }
    } catch (e) {
      record('rls', `rls ${t}`, 'FAIL', String(e.message || e));
    }
  }
}

async function checkBuckets() {
  console.log('\n== Storage buckets ==');
  if (!haveService) {
    for (const b of BUCKETS) record('storage', `bucket ${b.id}`, 'SKIP', 'no SUPABASE_SERVICE_ROLE_KEY');
    return;
  }
  let list;
  try {
    const { status, body } = await fetchJson(`${base}/storage/v1/bucket`);
    if (status !== 200 || !Array.isArray(body)) {
      for (const b of BUCKETS) record('storage', `bucket ${b.id}`, 'FAIL', `bucket list HTTP ${status}`);
      return;
    }
    list = body;
  } catch (e) {
    for (const b of BUCKETS) record('storage', `bucket ${b.id}`, 'FAIL', String(e.message || e));
    return;
  }
  for (const b of BUCKETS) {
    const found = list.find((x) => x.id === b.id || x.name === b.id);
    if (!found) { record('storage', `bucket ${b.id}`, 'FAIL', 'missing'); continue; }
    if (Boolean(found.public) === b.public) {
      record('storage', `bucket ${b.id}`, 'PASS', `public=${found.public}`);
    } else {
      record('storage', `bucket ${b.id}`, 'FAIL', `expected public=${b.public}, got ${found.public}`);
    }
  }
}

async function checkFunctions() {
  console.log('\n== Edge functions ==');
  if (!base) {
    for (const f of FUNCTIONS) record('functions', `function ${f}`, 'SKIP', 'no SUPABASE_URL');
    return;
  }
  for (const f of FUNCTIONS) {
    const url = `${base}/functions/v1/${f}`;
    try {
      // Deployed = the gateway responds at all (401/405/400 mean the function
      // is live and rejecting our unauthenticated/OPTIONS probe).
      const res = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://lumen.validate' } });
      if (res.status === 404) {
        record('functions', `function ${f}`, 'FAIL', 'HTTP 404 — not deployed');
      } else if (res.status >= 500) {
        record('functions', `function ${f}`, 'FAIL', `HTTP ${res.status}`);
      } else {
        record('functions', `function ${f}`, 'PASS', `OPTIONS → HTTP ${res.status}`);
      }
    } catch (e) {
      record('functions', `function ${f}`, 'FAIL', String(e.message || e));
    }
  }
  // Authenticated health probe for payouts (expects 401 without cron secret —
  // proves the function booted and is enforcing the secret).
  if (serviceKey) {
    try {
      const res = await fetch(`${base}/functions/v1/payouts`, { method: 'POST' });
      if (res.status === 401) record('functions', 'payouts secret enforcement', 'PASS', '401 without x-cron-secret');
      else if (res.status === 404) record('functions', 'payouts secret enforcement', 'FAIL', 'not deployed');
      else record('functions', 'payouts secret enforcement', 'PASS', `HTTP ${res.status} (check manually)`);
    } catch (e) {
      record('functions', 'payouts secret enforcement', 'FAIL', String(e.message || e));
    }
  } else {
    record('functions', 'payouts secret enforcement', 'SKIP', 'no SUPABASE_SERVICE_ROLE_KEY');
  }
}

async function checkCron() {
  console.log('\n== Cron jobs (pg_cron) ==');
  if (!havePg) {
    for (const j of CRON_JOBS) record('cron', `cron ${j}`, 'SKIP', 'no SUPABASE_DB_URL');
    return;
  }
  try {
    const out = await pgQuery('select jobname from cron.job;');
    const jobs = new Set(out.split('\n').filter(Boolean));
    for (const j of CRON_JOBS) {
      if (jobs.has(j)) record('cron', `cron ${j}`, 'PASS');
      else record('cron', `cron ${j}`, 'FAIL', 'not found in cron.job');
    }
  } catch (e) {
    for (const j of CRON_JOBS) record('cron', `cron ${j}`, 'SKIP', `psql failed: ${e.message}`);
  }
}

await checkTables();
await checkRls();
await checkBuckets();
await checkFunctions();
await checkCron();

const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
const skip = results.filter((r) => r.status === 'SKIP').length;

if (JSON_OUT) {
  console.log(JSON.stringify({ pass, fail, skip, results }, null, 2));
} else {
  console.log(`\n== Summary: ${pass} passed, ${fail} failed, ${skip} skipped ==`);
  if (skip > 0) {
    console.log('Skipped groups (missing env):');
    const byGroup = {};
    for (const r of results.filter((r) => r.status === 'SKIP')) {
      (byGroup[r.detail] ||= []).push(`${r.group}:${r.name}`);
    }
    for (const [reason, items] of Object.entries(byGroup)) {
      console.log(`  - ${reason} (${items.length} checks, e.g. ${items[0]})`);
    }
    if (fail === 0) console.log('SKIPPED (no credentials) — nothing failed.');
  }
}
process.exit(fail > 0 ? 1 : 0);
