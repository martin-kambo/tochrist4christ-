// netlify/functions/verify-member-auth.js
//
// Validates the member_session cookie set by magic-login.js.
// Returns { authenticated: true, user: { email, firstName, lastName, faithStage } }
// or      { authenticated: false }.
//
// Required environment variables:
//   SESSION_SECRET  — same secret used by magic-login.js to sign the JWT
//
// V2 PHASE 1: the cookie-parsing and JWT-verification logic that used to be
// duplicated inline here now lives in shared/member-auth.js, so every
// private endpoint added in this phase (member-me, get-progress,
// wellbeing, etc.) verifies the session the exact same way this file
// always has. The response shape and behavior of this endpoint are
// unchanged.

const { parseCookies, verifyMemberJWT } = require('./shared/member-auth');

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
  const cookies = parseCookies(cookieHeader);

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
    const payload = verifyMemberJWT(token, SESSION_SECRET);

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
