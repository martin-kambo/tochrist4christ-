// netlify/functions/shared/member-auth.js
//
// V2 PHASE 1 — Canonical server-side member-identity helper.
//
// Every new private endpoint in Phase 1 (member-me, get-progress,
// update-progress, the wellbeing endpoints, and the secured
// daily-engagement endpoints) derives "who is calling" through this file
// and ONLY through this file. Nothing here ever trusts a request body,
// query string, or localStorage value as proof of identity — identity is
// established solely by verifying the existing `member_session` cookie
// (the same cookie/JWT format magic-login.js already issues).
//
// This does not introduce a second login system and does not change the
// member-session cookie format. It is a shared version of the cookie
// parsing + JWT verification that verify-member-auth.js already
// implemented on its own — see verify-member-auth.js, which now calls
// getSessionUser() from here instead of duplicating that logic.
//
// Required env vars (unchanged from the rest of the codebase):
//   SESSION_SECRET       — same HMAC key magic-login.js signs with
//   NETLIFY_SITE_ID      — for Netlify Blobs access (member profile lookup)
//   NETLIFY_BLOBS_TOKEN  — for Netlify Blobs access

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

// ---------------------------------------------------------------------------
// Cookie parsing (same behavior as verify-member-auth.js's previous inline copy)
// ---------------------------------------------------------------------------
function parseCookies(cookieHeader = '') {
  const cookies = {};
  cookieHeader.split(';').forEach((c) => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[decodeURIComponent(k.trim())] = decodeURIComponent(v.join('=').trim());
  });
  return cookies;
}

// ---------------------------------------------------------------------------
// Minimal HS256 JWT verifier — identical algorithm to magic-login.js's
// createJWT() / verify-member-auth.js's previous inline verifyJWT().
// ---------------------------------------------------------------------------
function verifyMemberJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');

  const [header, payload, sig] = parts;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid signature');
  }

  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

// ---------------------------------------------------------------------------
// Session-only identity (fast path — no Blobs read).
// Returns { email, firstName, lastName, faithStage, role } or null.
// ---------------------------------------------------------------------------
function getSessionUser(event) {
  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) return null;

  const cookieHeader = (event.headers && (event.headers.cookie || event.headers.Cookie)) || '';
  const token = parseCookies(cookieHeader)['member_session'];
  if (!token) return null;

  try {
    const payload = verifyMemberJWT(token, SESSION_SECRET);

    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null; // expired — fail closed
    }
    if (!payload.email) return null;

    return {
      email: String(payload.email).toLowerCase().trim(),
      firstName: payload.firstName || '',
      lastName: payload.lastName || '',
      faithStage: payload.faithStage || 'just_starting',
      role: payload.role || 'member',
    };
  } catch {
    return null; // malformed / bad signature — fail closed
  }
}

// ---------------------------------------------------------------------------
// Blobs helpers — same pattern/key derivation add-member.js and
// send-welcome-email.js already use for the "members" store.
// ---------------------------------------------------------------------------
function blobsStore(name) {
  const opts = { name };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_BLOBS_TOKEN;
  }
  return getStore(opts);
}

function memberKey(email) {
  return Buffer.from(String(email).toLowerCase().trim()).toString('base64url');
}

// ---------------------------------------------------------------------------
// Canonical member identity — session identity + stored profile fields.
// Returns null (never throws) if there is no valid member_session.
// This is the function every Phase 1 private endpoint should call.
// ---------------------------------------------------------------------------
async function getAuthenticatedMember(event, options = {}) {
  const session = getSessionUser(event);
  if (!session) return null;

  let stored = null;
  try {
    const store = blobsStore('members');
    stored = await store.get(memberKey(session.email), { type: 'json' });
  } catch (err) {
    // Default (Phase 1/2 behavior, unchanged): profile enrichment is
    // best-effort; the session is still valid, so degrade to session data.
    //
    // V2 PHASE 3 — { strict: true }: for any decision that depends on the
    // STORED record (mentorStatus), a failed read must NOT be quietly
    // treated as "ordinary member" — that would let a transient outage make
    // an approved mentor look like a plain member (and, in
    // apply-for-mentor, overwrite their approved application). Strict
    // callers get the error and must fail closed.
    if (options.strict) throw err;
    stored = null;
  }

  return {
    email: session.email,
    firstName: (stored && stored.firstName) || session.firstName || '',
    lastName: (stored && stored.lastName) || session.lastName || '',
    faithStage: (stored && stored.faithStage) || session.faithStage || 'just_starting',
    joinedISO: (stored && stored.joinedISO) || null,
    joined: (stored && stored.joined) || null,
    role: session.role,
    // V2 PHASE 3 — additive only; extends the existing member model rather
    // than introducing a second identity system (see
    // TC4C_V2_PHASE3_ARCHITECTURE.md §"Mentor status"). Absent on any
    // member record created before Phase 3, hence the 'member' default —
    // an absent field must never be read as elevated access.
    mentorStatus: (stored && stored.mentorStatus) || 'member',
  };
}

/**
 * V2 PHASE 3 — updates ONLY the mentorStatus field on an existing member's
 * Blobs record, preserving every other field untouched.
 *
 * Deliberately fails closed rather than gracefully: unlike
 * getAuthenticatedMember()'s best-effort profile enrichment (where a read
 * failure just means "less personalization, session still valid"), a
 * failure here must NEVER be treated as "no existing record" — that would
 * mean writing a fresh {mentorStatus: ...} object that silently discards
 * the member's real name, faith stage, join date, etc. So: a missing
 * record (the member genuinely doesn't exist) throws, and any other read
 * failure also throws. Nothing is ever written on top of an unread state.
 */
async function setMentorStatus(email, status) {
  const store = blobsStore('members');
  const key = memberKey(email);
  const existing = await store.get(key, { type: 'json' });
  if (!existing) {
    throw new Error(`setMentorStatus: no existing member record for ${email}`);
  }
  const updated = { ...existing, mentorStatus: status };
  await store.setJSON(key, updated);
  return updated;
}

/**
 * V2 PHASE 3 — raw member-record lookup BY EMAIL, with no session
 * involved at all. This is intentionally different from
 * getAuthenticatedMember(): it exists only for already-authorized ADMIN
 * contexts that legitimately need to look up an arbitrary target member
 * (e.g. "does this applicant currently hold mentor status?"), the same
 * way delete-member.js/mark-answered.js already take a target email in
 * their request body. Callers MUST verify admin authorization (see
 * shared/admin-auth.js) themselves before calling this — this function
 * performs no authorization of its own. Never use this to establish "who
 * is calling" — only ever "who is this admin action about."
 */
async function getMemberRecord(email) {
  const store = blobsStore('members');
  return store.get(memberKey(email), { type: 'json' }); // null if none; throws on a genuine failure
}

module.exports = {
  parseCookies,
  verifyMemberJWT,
  getSessionUser,
  getAuthenticatedMember,
  getMemberRecord,
  setMentorStatus,
  memberKey,
  blobsStore,
};

// This file is a shared utility, not a callable Netlify function — same
// guard pattern as shared/netlify.js, so Netlify doesn't try to deploy it
// as an invokable endpoint.
exports.handler = async () => ({
  statusCode: 404,
  body: JSON.stringify({ error: 'Not a callable endpoint.' }),
});
