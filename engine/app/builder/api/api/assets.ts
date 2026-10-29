// Vercel serverless route: POST /api/assets
// Server-side worker trigger for the Supabase `asset-pipeline` edge function.
// Authenticates to Supabase with the SERVICE ROLE key (server-only env var),
// so the browser never sees it.
//
// Caller auth (two accepted forms):
//   1. Header  x-cron-secret: <CRON_SECRET>            (manual / external cron)
//   2. Vercel cron: header x-vercel-cron: 1 AND query ?secret=<CRON_SECRET>
//      (vercel.json: { "path": "/api/assets?secret=$CRON_SECRET", ... } —
//       set the literal value when writing vercel.json, not an env reference)
export const config = { runtime: 'edge' };

const FN_URL = `${process.env.SUPABASE_FUNCTION_BASE ?? process.env.VITE_SUPABASE_URL}/functions/v1/asset-pipeline`;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get('x-cron-secret') === secret) return true;
  const url = new URL(req.url);
  if (req.headers.get('x-vercel-cron') === '1' && url.searchParams.get('secret') === secret) return true;
  return false;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!authorized(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // eyJ… legacy JWT, server-only
  if (!serviceKey) {
    return new Response(JSON.stringify({ error: 'Service role key not configured' }), { status: 500 });
  }

  const upstream = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${serviceKey}`, // service-role bearer — checked in-function via keysEqual()
    },
    body: await req.text(),
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
