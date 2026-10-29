/**
 * publish-pipeline — POST { project_id, config }
 *
 * Verifies the caller (user JWT) is owner/editor of the project, assembles a
 * static bundle, enforces size budgets, uploads to the `bundles` bucket at
 * `{project_id}/{publish_id}/`, inserts a `publishes` row, and returns it.
 *
 * ── ENGINE PIPELINE SEAM ────────────────────────────────────────────────────
 * The real @lumen/build pipeline (packages/build in the engine repo) runs on
 * Node and cannot execute inside a Supabase edge function (Deno, no npm
 * workspace). The seam is `assembleBundle()` below: it currently emits a
 * minimal static export (index.html embedding the config JSON + a pinned
 * import map pointing at the vendored runtime placeholder). In production,
 * replace its body with an enqueue/callback to a Node worker that runs
 * `@lumen/build` against the same contract:
 *   in:  { project_id, config }
 *   out: files: Array<{ path, content, role: 'js'|'css'|'html'|'asset' }>
 * Everything downstream of assembleBundle() (budgets, hashing, storage,
 * publishes row) is pipeline-agnostic and stays as-is.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Budgets mirror packages/build/src/budgets.ts DEFAULT_BUDGETS:
 *   js-gz            ≤ 170 KiB (174080 bytes), gzip level-9 equivalent
 *   css-gz           ≤ 40 KiB  (40960 bytes)
 *   critical-assets  ≤ 1.2 MiB (1228800 bytes) raw
 * with the same +10% warn tolerance; 'fail' → HTTP 400 with violations list.
 */

import { isPreflight, preflightResponse } from '../_shared/cors.ts';
import { AuthError, bearerToken, getUser, requireRole } from '../_shared/auth.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { err, json } from '../_shared/responses.ts';
import { canonicalJson, sha256Hex } from '../_shared/hash.ts';

// ── Budget constants (MUST match packages/build/src/budgets.ts) ─────────────
const BUDGETS = {
  'js-gz': 170 * 1024,
  'css-gz': 40 * 1024,
  'critical-assets': 1228800,
} as const;
const WARN_TOLERANCE = 0.1;

type BudgetMetric = keyof typeof BUDGETS;
type FileRole = 'js' | 'css' | 'html' | 'asset';

interface BundleFile {
  path: string;
  content: string | Uint8Array;
  role: FileRole;
}

interface BudgetOutcome {
  metric: BudgetMetric;
  budget: number;
  actual: number;
  status: 'pass' | 'warn' | 'fail';
}

/** Gzip byte length via CompressionStream (Deno-native gzip). */
async function gzipSize(content: string | Uint8Array): Promise<number> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return buf.byteLength;
}

async function checkBudgets(files: BundleFile[]): Promise<{ outcomes: BudgetOutcome[]; passed: boolean }> {
  const outcomes: BudgetOutcome[] = [];
  for (const metric of Object.keys(BUDGETS) as BudgetMetric[]) {
    const budget = BUDGETS[metric];
    let actual = 0;
    for (const f of files) {
      if (metric === 'js-gz' && /\.[cm]?js$/i.test(f.path)) actual += await gzipSize(f.content);
      else if (metric === 'css-gz' && /\.css$/i.test(f.path)) actual += await gzipSize(f.content);
      else if (metric === 'critical-assets' && f.role === 'asset') {
        actual += typeof f.content === 'string' ? new TextEncoder().encode(f.content).byteLength : f.content.byteLength;
      }
    }
    const status: BudgetOutcome['status'] =
      actual <= budget ? 'pass' : actual <= budget * (1 + WARN_TOLERANCE) ? 'warn' : 'fail';
    outcomes.push({ metric, budget, actual, status });
  }
  return { outcomes, passed: outcomes.every((o) => o.status !== 'fail') };
}

/**
 * Minimal static export. SEAM: swap for the real @lumen/build Node worker.
 * `config` is embedded verbatim; the runtime placeholder is pinned by
 * version in the import map so bundles are reproducible.
 */
function assembleBundle(projectId: string, config: unknown): BundleFile[] {
  const runtimeVersion = '0.0.0-placeholder';
  const importMap = {
    imports: {
      '@lumen/runtime': `/runtime/${runtimeVersion}/runtime.js`,
    },
  };
  const indexHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Lumen Export — ${escapeHtml(projectId)}</title>
<script type="importmap">${JSON.stringify(importMap)}</script>
</head>
<body>
<div id="lumen-root"></div>
<script id="lumen-config" type="application/json">${escapeScriptJson(JSON.stringify(config))}</script>
<script type="module">
import { boot } from '@lumen/runtime';
boot(document.getElementById('lumen-root'), JSON.parse(document.getElementById('lumen-config').textContent));
</script>
</body>
</html>
`;
  return [{ path: 'index.html', content: indexHtml, role: 'html' }];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** Prevent `</script>` breakout when embedding JSON in a script tag. */
function escapeScriptJson(s: string): string {
  return s.replace(/</g, '\\u003c');
}

interface PublishRequest {
  project_id: string;
  config: unknown;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (isPreflight(req)) return preflightResponse(req);
  if (req.method !== 'POST') return err(req, 405, 'Method not allowed');

  try {
    const jwt = bearerToken(req);
    const user = await getUser(jwt);

    let body: PublishRequest;
    try {
      body = await req.json();
    } catch {
      return err(req, 400, 'Invalid JSON body');
    }
    if (!body || typeof body.project_id !== 'string' || body.config === undefined) {
      return err(req, 400, 'Body must be { project_id: string, config: object }');
    }

    await requireRole(body.project_id, user.id, ['owner', 'editor']);

    const db = serviceClient();
    const publishId = crypto.randomUUID();
    const configHash = await sha256Hex(canonicalJson(body.config));

    // 1. Assemble bundle (engine seam — see header).
    const files = assembleBundle(body.project_id, body.config);

    // 2. Per-file sha256 → manifest.json.
    const manifestEntries: Record<string, { sha256: string; bytes: number; role: FileRole }> = {};
    for (const f of files) {
      const bytes =
        typeof f.content === 'string' ? new TextEncoder().encode(f.content).byteLength : f.content.byteLength;
      manifestEntries[f.path] = { sha256: await sha256Hex(f.content), bytes, role: f.role };
    }
    const manifest: BundleFile = {
      path: 'manifest.json',
      content: JSON.stringify(
        { project_id: body.project_id, publish_id: publishId, config_hash: configHash, files: manifestEntries },
        null,
        2,
      ),
      role: 'asset',
    };
    const allFiles = [...files, manifest];

    // 3. Budgets — fail hard with violations list.
    const { outcomes, passed } = await checkBudgets(allFiles);
    if (!passed) {
      return err(req, 400, 'Bundle exceeds size budgets', {
        violations: outcomes.filter((o) => o.status === 'fail'),
        outcomes,
      });
    }

    // 4. Upload to bundles bucket at {project_id}/{publish_id}/.
    const bundlePrefix = `${body.project_id}/${publishId}`;
    for (const f of allFiles) {
      const { error: upErr } = await db.storage.from('bundles').upload(`${bundlePrefix}/${f.path}`, f.content, {
        contentType: f.path.endsWith('.html')
          ? 'text/html'
          : f.path.endsWith('.js')
            ? 'text/javascript'
            : f.path.endsWith('.css')
              ? 'text/css'
              : 'application/json',
        upsert: false,
      });
      if (upErr) return err(req, 500, `Bundle upload failed at ${f.path}`, upErr.message);
    }

    // 5. publishes row. URL uses the storage public path for the bundle; a
    //    `https://<slug>.mock.vercel.app`-style deployment URL is produced by
    //    the external deployer and patched in later (same seam note).
    const { data: urlData } = db.storage.from('bundles').getPublicUrl(`${bundlePrefix}/index.html`);
    const deploymentId = `dep_${publishId.replace(/-/g, '').slice(0, 16)}`;
    const { data: publish, error: insErr } = await db
      .from('publishes')
      .insert({
        id: publishId,
        project_id: body.project_id,
        deployment_id: deploymentId,
        url: urlData.publicUrl,
        config_hash: configHash,
        bundle_path: bundlePrefix,
        status: 'live',
      })
      .select()
      .single();
    if (insErr) return err(req, 500, 'Failed to insert publishes row', insErr.message);

    return json(req, { publish, budgets: outcomes }, 201);
  } catch (e) {
    if (e instanceof AuthError) return err(req, e.status, e.message);
    console.error('publish-pipeline error', e);
    return err(req, 500, 'Internal error', e instanceof Error ? e.message : String(e));
  }
});
