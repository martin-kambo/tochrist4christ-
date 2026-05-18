// netlify/functions/magic-login.js
//
// Validates a one-time magic token from the URL query string, creates a
// JWT session cookie, and redirects to the course.
//
// Two token sources are handled transparently:
//   source:'welcome' — 7-day tokens minted by send-welcome-email.js
//   source:'login'   — 15-min tokens minted by request-magic-link.js
//
// The token's own `exp` field (Unix ms) is always the source of truth for
// expiry; `source` is logged for analytics only.
//
// Session cookie format: JWT (header.payload.signature) with HS256
// This MUST match the format expected by verify-member-auth.js
//
// Required env vars:
//   SESSION_SECRET       — HMAC key for JWT signing
//   NETLIFY_SITE_ID      — for Netlify Blobs access
//   NETLIFY_BLOBS_TOKEN  — for Netlify Blobs access

const crypto       = require('crypto');
const { getStore } = require('@netlify/blobs');

// ---------------------------------------------------------------------------
// Blobs: magic-tokens store
// ---------------------------------------------------------------------------
function getTokenStore() {
  const opts = { name: 'magic-tokens' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_BLOBS_TOKEN;
  }
  return getStore(opts);
}

// ---------------------------------------------------------------------------
// Create JWT session token (HS256)
// Format: header.payload.signature
// This MUST match the format verify-member-auth.js expects!
// ---------------------------------------------------------------------------
function createJWT({ email, firstName, lastName, faithStage }) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not set');

  const now = Math.floor(Date.now() / 1000);
  const exp = now + (30 * 24 * 60 * 60); // 30 days

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const payload = {
    email,
    firstName:  firstName  || '',
    lastName:   lastName   || '',
    faithStage: faithStage || 'just_starting',
    iat: now,
    exp,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

// ---------------------------------------------------------------------------
// Error page helper
// ---------------------------------------------------------------------------
function errorPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} — To Christ For Christ</title>
  <style>
    body { font-family: Georgia, serif; background: #0D1117; color: #e8e2d4;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; }
    .card { background: #161B22; border: 1px solid rgba(201,168,76,0.25);
            border-radius: 8px; padding: 40px 48px; max-width: 460px; text-align: center; }
    h1 { color: #C9A84C; font-size: 1.5rem; margin: 0 0 12px; }
    p  { color: rgba(245,239,224,0.6); font-size: 0.95rem; line-height: 1.7; margin: 0 0 24px; }
    a  { display: inline-block; background: #C9A84C; color: #2C1A0E;
         font-family: Helvetica, sans-serif; font-size: 0.75rem; font-weight: 700;
         letter-spacing: 0.1em; text-transform: uppercase; padding: 11px 28px;
         text-decoration: none; border-radius: 2px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="https://tochristforchrist.org/course.html">Go to Course</a>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  const token = (event.queryStringParameters || {}).token;

  // Validate token format: 64 hex characters
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: errorPage('Invalid Link', 'This sign-in link is not valid. Please request a new one.'),
    };
  }

  // Retrieve token data from Blobs
  const store = getTokenStore();
  let tokenData;
  try {
    tokenData = await store.get(token, { type: 'json' });
  } catch (err) {
    console.error('magic-login: Blobs token lookup failed:', err.message);
    tokenData = null;
  }

  if (!tokenData) {
    return {
      statusCode: 410,
      headers: { 'Content-Type': 'text/html' },
      body: errorPage(
        'Link Already Used',
        'This sign-in link has already been used or has expired. ' +
        'Return to the course page to request a new one.'
      ),
    };
  }

  // Check expiry (source-independent — exp is always authoritative)
  if (Date.now() > tokenData.exp) {
    // Clean up expired token
    try { await store.delete(token); } catch {}

    const sourceLabel = tokenData.source === 'login' ? '15 minutes' : '7 days';
    return {
      statusCode: 410,
      headers: { 'Content-Type': 'text/html' },
      body: errorPage(
        'Link Expired',
        `This sign-in link was valid for ${sourceLabel} and has now expired. ` +
        'Please return to the course page to request a new one.'
      ),
    };
  }

  // Log source for analytics
  console.log(`magic-login: source=${tokenData.source || 'unknown'} email=${tokenData.email}`);

  // Consume token (one-time use)
  try {
    await store.delete(token);
  } catch (err) {
    console.error('Failed to delete consumed token:', err);
    // Continue — session JWT is still valid
  }

  // Create JWT session
  let sessionJWT;
  try {
    sessionJWT = createJWT({
      email:      tokenData.email,
      firstName:  tokenData.firstName,
      lastName:   tokenData.lastName,
      faithStage: tokenData.faithStage,
    });
  } catch (err) {
    console.error('Failed to create JWT:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: errorPage('Server Error', 'Something went wrong. Please try again.'),
    };
  }

  // Redirect to course with session cookie AND session data query param
  // httpOnly cookie is for API requests (secure against XSS)
  // Session data in URL is for client-side auth checks (localStorage)
  const sessionData = {
    email: tokenData.email,
    firstName: tokenData.firstName || '',
    lastName: tokenData.lastName || '',
    faithStage: tokenData.faithStage || 'just_starting',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
  
  const sessionDataParam = Buffer.from(JSON.stringify(sessionData)).toString('base64url');

  // ✅ FIXED: Set-Cookie header is now a single properly formatted string
  // All cookie attributes (HttpOnly, Secure, SameSite, etc.) are in ONE header value
  const cookieValue = `member_session=${sessionJWT}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}`;

  return {
    statusCode: 302,
    headers: {
      'Set-Cookie': cookieValue,
      'Location': `https://tochristforchrist.org/course.html?auth=${sessionDataParam}`,
    },
    body: '',
  };
};