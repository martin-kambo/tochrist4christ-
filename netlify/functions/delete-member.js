/**
 * /.netlify/functions/delete-member
 *
 * Permanently removes a member from the system.
 * Members are stored in Netlify Blobs (by UUID key) by add-member.js.
 * Progress/session data lives in Redis (by email key).
 *
 * ── Request ──────────────────────────────────────────────────────────────────
 * DELETE  { email: string }
 *
 * ── Response ─────────────────────────────────────────────────────────────────
 * 200  { success: true, deleted: { blob: string, redisKeys: string[] } }
 * 400  { error: 'email required' }
 * 401  { error: 'Unauthorised' }
 * 404  { error: 'Member not found' }
 * 500  { error: 'internal error' }
 */

const { getStore } = require('@netlify/blobs');
const { pipeline }  = require('./redis');

function blobsStore(name) {
  const opts = { name };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_BLOBS_TOKEN;
  }
  return getStore(opts);
}

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

  const raw = (body.email || body.memberId || '').trim().toLowerCase();
  if (!raw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return reply(400, { error: 'email required' });
  }
  const email = raw;

  // ── Find the member blob by scanning for matching email ───────────────────
  // add-member.js stores blobs keyed by UUID, so we must scan to find by email.
  let blobId = null;
  try {
    const store       = blobsStore('members');
    const { blobs }   = await store.list();

    for (const { key } of (blobs || [])) {
      let record;
      try { record = await store.get(key, { type: 'json' }); } catch { continue; }
      if (record && (record.email || '').trim().toLowerCase() === email) {
        blobId = key;
        break;
      }
    }

    if (!blobId) {
      console.warn(`[delete-member] Member not found in Blobs: ${email}`);
      return reply(404, { error: 'Member not found' });
    }

    // ── Delete the Blob record ─────────────────────────────────────────────
    await store.delete(blobId);
    console.log(`[delete-member] Deleted Blob ${blobId} for ${email}`);

  } catch (err) {
    console.error('[delete-member] Blobs error:', err);
    return reply(500, { error: 'internal error' });
  }

  // ── Delete Redis progress/session keys (best-effort) ──────────────────────
  const redisKeys = [`progress:${email}`, `session:${email}`];
  try {
    await pipeline(
      ['DEL', `progress:${email}`],
      ['DEL', `session:${email}`],
    );
    console.log(`[delete-member] Cleared Redis keys for ${email}`);
  } catch (err) {
    // Non-fatal — member blob already gone; Redis keys will expire naturally
    console.warn('[delete-member] Redis DEL warning (non-fatal):', err.message);
  }

  return reply(200, {
    success: true,
    deleted: { blob: blobId, redisKeys },
  });
};

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body),
  };
}