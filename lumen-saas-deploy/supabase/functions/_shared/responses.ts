/** JSON response helpers. */

import { corsHeaders } from './cors.ts';

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req.headers.get('origin')) },
  });
}

export function err(req: Request, status: number, message: string, extra?: unknown): Response {
  return json(req, { error: message, ...(extra !== undefined ? { detail: extra } : {}) }, status);
}
