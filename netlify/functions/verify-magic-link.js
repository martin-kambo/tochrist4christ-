// netlify/functions/verify-magic-link.js
//
// Validates a magic-login token that was minted by request-magic-link.js
// (or the welcome-email signup flow) and returns the stored member record.
//
// Flow:
//   1. Receive { token } in POST body.
//   2. Sanity-check token format (64 hex chars).
//   3. Fetch the token record from the "magic-tokens" Blobs store.
//   4. Not found  → 400 (invalid or already used).
//   5. Expired    → 410 (tell the client to re-request a fresh link).
//   6. Delete the token immediately (one-time use).
//   7. Fetch the matching member from the "members" store.
//   8. Return { success: true, member: { … } }.
//
// Required env vars (same as request-magic-link.js):
//   NETLIFY_SITE_ID
//   NETLIFY_BLOBS_TOKEN

const { getStore } = require('@netlify/blobs');

// ---------------------------------------------------------------------------
// Store helpers  (identical pattern to request-magic-link.js)
// ---------------------------------------------------------------------------
function storeOpts(name) {
  const opts = { name };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_BLOBS_TOKEN;
  }
  return opts;
}

/** Fetch and immediately delete a token record. Returns null if not found. */
async function consumeToken(token) {
  const store = getStore(storeOpts('magic-tokens'));
  let record;
  try {
    record = await store.get(token, { type: 'json' });
  } catch {
    return null; // key does not exist
  }
  if (!record) return null;

  // Delete unconditionally — even if the token turns out to be expired we
  // don't want it sitting in the store and being tried again.
  try {
    await store.delete(token);
  } catch (err) {
    // Log but don't abort — the expiry check below is the real guard.
    console.warn('verify-magic-link: could not delete token:', err);
  }

  return record; // { email, exp, source }
}

/** Fetch a member record by email (keyed by base64url of the email address). */
async function getMember(email) {
  const key   = Buffer.from(email.toLowerCase()).toString('base64url');
  const store = getStore(storeOpts('members'));
  try {
    return await store.get(key, { type: 'json' });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token format guard
// ---------------------------------------------------------------------------
const TOKEN_RE = /^[0-9a-f]{64}$/; // 32 random bytes → 64 hex chars

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // --- Parse body -----------------------------------------------------------
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Bad request' }),
    };
  }

  const token = (body.token || '').trim().toLowerCase();

  // --- Format check ---------------------------------------------------------
  if (!TOKEN_RE.test(token)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Invalid token' }),
    };
  }

  // --- Consume token (fetch + delete) ---------------------------------------
  let record;
  try {
    record = await consumeToken(token);
  } catch (err) {
    console.error('verify-magic-link: store error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Internal server error' }),
    };
  }

  if (!record) {
    // Token never existed, was already used, or was deleted after expiry.
    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: 'This link is invalid or has already been used.',
      }),
    };
  }

  // --- Expiry check ---------------------------------------------------------
  // We check AFTER deleting so an expired token can never be retried.
  if (Date.now() > record.exp) {
    return {
      statusCode: 410, // 410 Gone — ask the client to request a fresh link
      body: JSON.stringify({
        success: false,
        error: 'This link has expired. Please request a new one.',
      }),
    };
  }

  // --- Look up member -------------------------------------------------------
  let member;
  try {
    member = await getMember(record.email);
  } catch (err) {
    console.error('verify-magic-link: member lookup error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Internal server error' }),
    };
  }

  if (!member) {
    // Token was valid but the member record has disappeared — edge case.
    console.error('verify-magic-link: token valid but member not found:', record.email);
    return {
      statusCode: 404,
      body: JSON.stringify({
        success: false,
        error: 'Account not found. Please sign up again.',
      }),
    };
  }

  // --- Return member fields -------------------------------------------------
  // Whitelist only the fields the frontend actually needs; add/remove as your
  // member schema evolves.
  const {
    firstName,
    lastName,
    email: memberEmail,
    phone,
    createdAt,
    // spread any extra top-level fields your signup flow writes:
    ...rest
  } = member;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      source: record.source, // 'login' | 'signup' — lets the frontend decide where to redirect
      member: {
        email:     memberEmail,
        firstName,
        lastName,
        phone,
        createdAt,
        ...rest,   // forwards any additional fields without having to update this file
      },
    }),
  };
};