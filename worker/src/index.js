/**
 * Shared visit counter for the pixel-decay portrait.
 *
 * GET   /count -> { count }        read only
 * POST  /hit   -> { count }        increment, return the new value
 * POST  /reset -> { ok, count }    zero it; requires the RESET_KEY secret
 *
 * RESET_KEY lives only in the Worker (wrangler secret put RESET_KEY). The
 * page never contains it - the visitor types it and we compare here - so
 * the public source gives nobody the ability to reset the picture.
 *
 * Note on races: two visitors landing in the same instant can both read N
 * and both write N+1, losing a count. For a personal homepage that is
 * harmless. See README for the Durable Object version if you want the
 * count to be exactly right.
 */

const ALLOWED = [
  'https://jiheon-lee-97.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const KEY = 'count';

function cors(origin) {
  const ok = ALLOWED.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
}

// constant-time compare so the secret can't be recovered by timing probes
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body, headers, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    const read = async () => Number(await env.COUNTER.get(KEY)) || 0;

    if (url.pathname === '/count' && request.method === 'GET') {
      return json({ count: await read() }, headers);
    }

    if (url.pathname === '/hit' && request.method === 'POST') {
      // Refuse increments from pages that aren't yours. Doesn't stop a
      // determined curl, but stops the site being embedded elsewhere.
      if (origin && !ALLOWED.includes(origin)) {
        return json({ count: await read(), counted: false }, headers, 403);
      }
      const next = (await read()) + 1;
      await env.COUNTER.put(KEY, String(next));
      return json({ count: next, counted: true }, headers);
    }

    if (url.pathname === '/reset' && request.method === 'POST') {
      if (origin && !ALLOWED.includes(origin)) {
        return json({ ok: false }, headers, 403);
      }
      if (!env.RESET_KEY) {
        return json({ ok: false, error: 'reset not configured' }, headers, 501);
      }
      let body = {};
      try { body = await request.json(); } catch { /* malformed */ }
      if (!sameSecret(body.key, env.RESET_KEY)) {
        return json({ ok: false }, headers, 403);
      }
      await env.COUNTER.put(KEY, '0');
      return json({ ok: true, count: 0 }, headers);
    }

    return json({ error: 'not found' }, headers, 404);
  },
};
