// ============================================================
// FTP-PLAN CLOUD SYNC WORKER
// ============================================================
// A tiny Cloudflare Worker that stores each rider's ride log + plans, keyed by
// their Strava athlete id. Strava is the identity: the client sends its Strava
// access token, the Worker verifies it against Strava's /athlete endpoint to
// learn who's calling, then reads/writes that athlete's blob in a KV namespace.
//
// One endpoint: POST /sync  { records:[...], since:<ms> }
//   -> merges the incoming records (last write wins by updatedAt) and returns
//      every record updated after `since`. Deletes travel as {id,deleted,updatedAt}.
//
// Bind a KV namespace named RIDES (see wrangler.toml). No secrets needed —
// identity is proven by the caller's own Strava token.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/sync') {
      return json({ error: 'not found' }, 404);
    }
    if (!env.RIDES) return json({ error: 'KV namespace RIDES not bound' }, 500);

    // --- identity: verify the caller's Strava token ---
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'missing token' }, 401);

    let athlete;
    try {
      const r = await fetch('https://www.strava.com/api/v3/athlete', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) return json({ error: 'strava auth failed' }, 401);
      athlete = await r.json();
    } catch (e) {
      return json({ error: 'strava unreachable' }, 502);
    }
    if (!athlete || athlete.id === undefined) return json({ error: 'no athlete' }, 401);

    const key = 'rides:' + athlete.id;

    // --- body ---
    let body;
    try { body = await request.json(); } catch (e) { body = {}; }
    const incoming = Array.isArray(body.records) ? body.records : [];
    const since = Number(body.since) || 0;

    // --- load this athlete's store (a map of id -> record) ---
    let store = {};
    try {
      const raw = await env.RIDES.get(key);
      if (raw) store = JSON.parse(raw);
    } catch (e) { store = {}; }

    // --- merge incoming, last write wins by updatedAt ---
    let changed = false;
    for (const rec of incoming) {
      if (!rec || rec.id === undefined) continue;
      const ex = store[rec.id];
      if (!ex || (rec.updatedAt || 0) >= (ex.updatedAt || 0)) {
        store[rec.id] = rec;
        changed = true;
      }
    }
    if (changed) {
      try { await env.RIDES.put(key, JSON.stringify(store)); } catch (e) {}
    }

    // --- respond with everything newer than `since` ---
    const out = [];
    for (const id in store) {
      const r = store[id];
      if ((r.updatedAt || 0) > since) out.push(r);
    }
    return json({ records: out, now: Date.now(), count: out.length });
  },
};
