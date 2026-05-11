// netlify/functions/verify-member-auth.js
//
// Validates the member_session cookie set by magic-login.js.
// Returns { authenticated: true, user: { email, firstName, lastName, faithStage } }
// or      { authenticated: false }.
//
// Required environment variables:
//   SESSION_SECRET  — same secret used by magic-login.js to sign the JWT

const crypto = require('crypto');

// ── Minimal HS256 JWT verifier (no external deps) ────────────────────────────
function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');

  const [header, payload, sig] = parts;

  // Verify signature
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  // Constant-time comparison to prevent timing attacks
  const sigBuf  = Buffer.from(sig,      'base64url');
  const expBuf  = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid signature');
  }

  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache',
    // Allow course.html (same origin) to read this response
    'Access-Control-Allow-Origin': event.headers.origin || '*',
    'Access-Control-Allow-Credentials': 'true',
  };

  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) {
    console.error('Missing SESSION_SECRET env var');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ authenticated: false, error: 'Server misconfiguration' }),
    };
  }

  // ── Parse cookies ─────────────────────────────────────────────────────────
  const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
  const cookies = {};
  cookieHeader.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[decodeURIComponent(k.trim())] = decodeURIComponent(v.join('=').trim());
  });

  const token = cookies['member_session'];
  if (!token) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ authenticated: false }),
    };
  }

  // ── Verify ────────────────────────────────────────────────────────────────
  try {
    const payload = verifyJWT(token, SESSION_SECRET);

    // Check expiry
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ authenticated: false, reason: 'session_expired' }),
      };
    }

    // Valid session
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        authenticated: true,
        user: {
          email:      payload.email      || '',
          firstName:  payload.firstName  || '',
          lastName:   payload.lastName   || '',
          faithStage: payload.faithStage || 'just_starting',
          role:       payload.role       || 'member',
        },
      }),
    };

  } catch (err) {
    console.error('verify-member-auth: JWT validation failed —', err.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ authenticated: false }),
    };
  }
};