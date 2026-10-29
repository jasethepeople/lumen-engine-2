// Vercel serverless route: POST /api/publish
// Proxies the browser → Supabase Edge Function `publish-pipeline`.
// The user's Supabase access token (JWT) is forwarded as-is; the service
// role key is NEVER exposed to the browser.
export const config = { runtime: 'edge' };

const FN_URL = `${process.env.SUPABASE_FUNCTION_BASE ?? process.env.VITE_SUPABASE_URL}/functions/v1/publish-pipeline`;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const auth = req.headers.get('authorization');
  if (!auth) return new Response(JSON.stringify({ error: 'Missing user JWT' }), { status: 401 });

  const upstream = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: auth, // user JWT — verified in-function via auth.getUser
    },
    body: await req.text(),
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
