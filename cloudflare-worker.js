// Indoor Training Console — Strava token proxy.
//
// The only job of this Worker is to hold the Strava client secret so the
// browser never has to. Two routes:
//   POST /exchange   { code }            -> tokens (first connect)
//   POST /refresh    { refresh_token }   -> tokens (renewal)
// Uploads never come through here; the browser talks to Strava directly.
//
// Settings > Variables and Secrets on the Worker:
//   STRAVA_CLIENT_ID      248261
//   STRAVA_CLIENT_SECRET  (secret)
//   ALLOWED_ORIGIN        https://<username>.github.io   (comma-separate to allow more)

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = allowedOrigin(origin, env.ALLOWED_ORIGIN);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowed) return json({ message: 'origin not allowed' }, 403, cors);
    if (request.method !== 'POST') return json({ message: 'POST only' }, 405, cors);

    const url = new URL(request.url);
    let body = {};
    try { body = await request.json(); } catch (e) { return json({ message: 'bad json' }, 400, cors); }

    const params = new URLSearchParams();
    params.set('client_id', env.STRAVA_CLIENT_ID);
    params.set('client_secret', env.STRAVA_CLIENT_SECRET);

    if (url.pathname === '/exchange') {
      if (!body.code) return json({ message: 'code required' }, 400, cors);
      params.set('grant_type', 'authorization_code');
      params.set('code', String(body.code));
    } else if (url.pathname === '/refresh') {
      if (!body.refresh_token) return json({ message: 'refresh_token required' }, 400, cors);
      params.set('grant_type', 'refresh_token');
      params.set('refresh_token', String(body.refresh_token));
    } else {
      return json({ message: 'not found' }, 404, cors);
    }

    const res = await fetch('https://www.strava.com/oauth/token', { method: 'POST', body: params });
    const text = await res.text();
    // Pass Strava's answer through unchanged (tokens, athlete, or its error).
    return new Response(text, { status: res.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  },
};

function allowedOrigin(origin, list) {
  if (!origin) return false;
  // Local development is always fine: Strava itself whitelists localhost.
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return String(list || '').split(',').map(s => s.trim()).filter(Boolean).includes(origin);
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
