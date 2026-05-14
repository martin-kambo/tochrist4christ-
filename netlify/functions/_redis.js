/**
 * _redis.js  –  Thin Upstash Redis REST client (no npm dependency)
 *
 * Required env vars (set in Netlify → Site → Environment variables):
 *   UPSTASH_REDIS_REST_URL    e.g. https://your-db.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN  the bearer token from the Upstash console
 */

const BASE  = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!BASE || !TOKEN) {
  // Surface a clear error at cold-start rather than a cryptic 401 later.
  console.error('[redis] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set.');
}

/**
 * Execute one or more Redis commands via the Upstash pipeline endpoint.
 * Each command is an array: e.g. ['GET', 'key'] or ['SET', 'k', 'v', 'EX', 900]
 *
 * Returns an array of { result } objects in the same order.
 * Throws on network error or non-2xx HTTP status.
 */
async function pipeline(...commands) {
  const res = await fetch(`${BASE}/pipeline`, {
    method : 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upstash pipeline ${res.status}: ${text}`);
  }

  // Each element: { result: <value> } | { error: '<msg>' }
  const rows = await res.json();
  rows.forEach((row, i) => {
    if (row.error) throw new Error(`Redis command ${i} (${commands[i][0]}): ${row.error}`);
  });
  return rows.map(r => r.result);
}

/** Convenience: single command. */
async function cmd(...args) {
  const [result] = await pipeline(args);
  return result;
}

module.exports = { pipeline, cmd };