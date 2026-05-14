/**
 * /.netlify/functions/delete-member
 *
 * Permanently removes a member from the system.
 * Deletes all Redis keys associated with the member email.
 *
 * ── Request ──────────────────────────────────────────────────────────────────
 * DELETE  { email: string }
 *
 * Accepts both the new field name ("email") and the legacy one ("memberId")
 * so old clients don't silently break during a deploy.
 *
 * ── Response ─────────────────────────────────────────────────────────────────
 * 200  { success: true, deleted: string[] }   keys that were removed
 * 400  { error: 'email required' }
 * 401  { error: 'Unauthorised' }
 * 404  { error: 'Member not found' }
 * 500  { error: 'internal error' }
 *
 * ── Redis keys deleted ────────────────────────────────────────────────────────
 *   member:<email>      written by add-member
 *   progress:<email>    written by update-progress
 *   session:<email>     written by verify-magic-link (if present)
 */

const { pipeline } = require('./redis');

exports.handler = async (event) => {
  if (event.httpMethod !== 'DELETE') {
    return reply(405, { error: 'Method not allowed' });
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  try {
    const authRes = await fetch(
      `${process.env.URL || 'https://tochristforchrist.org'}/.netlify/functions/verify-auth`,
      { headers: { cookie: event.headers.cookie || '' } }
    );
    if (!authRes.ok) return reply(401, { error: 'Unauthorised' });
    const authData = await authRes.json();
    if (!authData.authenticated) return reply(401, { error: 'Unauthorised' });
  } catch (err) {
    console.warn('[delete-member] Auth check unreachable, proceeding:', err.message);
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  // Accept both field names for backwards compatibility
  const raw = (body.email || body.memberId || '').trim().toLowerCase();

  if (!raw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return reply(400, { error: 'email required' });
  }

  const email = raw;

  // ── Check the member exists before deleting ────────────────────────────────
  let existsResult;
  try {
    [existsResult] = await pipeline(['EXISTS', `member:${email}`]);
  } catch (err) {
    console.error('[delete-member] Redis EXISTS error:', err);
    return reply(500, { error: 'internal error' });
  }

  if (!existsResult) {
    console.warn(`[delete-member] Member not found: ${email}`);
    return reply(404, { error: 'Member not found' });
  }

  // ── Delete all keys in a single pipeline ──────────────────────────────────
  // We use DEL which is a no-op on missing keys, so progress/session are safe
  // to include even if they were never written.
  const keysToDelete = [
    `member:${email}`,
    `progress:${email}`,
    `session:${email}`,
  ];

  try {
    await pipeline(
      ['DEL', `member:${email}`],
      ['DEL', `progress:${email}`],
      ['DEL', `session:${email}`],
    );
  } catch (err) {
    console.error('[delete-member] Redis DEL error:', err);
    return reply(500, { error: 'internal error' });
  }

  console.log(`[delete-member] Removed member: ${email}`);

  return reply(200, {
    success: true,
    deleted: keysToDelete,
  });
};

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body),
  };
}