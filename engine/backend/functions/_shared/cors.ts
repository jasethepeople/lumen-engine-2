/**
 * CORS helpers shared by all edge functions.
 *
 * Allowed origins are env-configurable via ALLOWED_ORIGINS (comma-separated);
 * defaults to '*' for development. Tighten in production.
 */

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function corsHeaders(origin: string | null): Record<string, string> {
  const allow =
    allowedOrigins.includes('*') || (origin !== null && allowedOrigins.includes(origin))
      ? (origin ?? '*')
      : allowedOrigins[0] ?? '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

/** True if this is a preflight request that should be answered immediately. */
export function isPreflight(req: Request): boolean {
  return req.method === 'OPTIONS';
}

export function preflightResponse(req: Request): Response {
  return new Response('ok', { headers: corsHeaders(req.headers.get('origin')) });
}
