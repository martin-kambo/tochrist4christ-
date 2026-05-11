// netlify/functions/magic-login.js
//
// Validates a one-time magic token from the URL query string, sets a
// session cookie via verify-auth, then redirects to the course.
//
// Two token sources are handled transparently:
//   source:'welcome' — 7-day tokens minted by send-welcome-email.js
//   source:'login'   — 15-min tokens minted by request-magic-link.js
//
// The token's own `exp` field (Unix ms) is always the source of truth for
// expiry; `source` is logged for analytics only.
//
// Required env vars:
//   SESSION_SECRET       — HMAC key for session cookie signing
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
// Session cookie (HttpOnly, Secure, SameSite=Strict)
// Signs a simple payload: "email|expiry" with HMAC-SHA256
// ---------------------------------------------------------------------------
function buildSessionCookie({ email, firstName, lastName, faithStage }) {
  const secret  = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not set');

  const exp     = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const payload = JSON.stringify({ email, firstName, lastName, faithStage, exp });
  const sig     = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const value   = Buffer.from(payload).toString('base64') + '.' + sig;

  return [
    `member_session=${value}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${30 * 24 * 60 * 60}`,
  ].join('; ');
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

  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: errorPage('Invalid Link', 'This sign-in link is not valid. Please request a new one.'),
    };
  }

  // Retrieve token data
  const store = getTokenStore();
  let tokenData;
  try {
    tokenData = await store.get(token, { type: 'json' });
  } catch {
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

  // Log source for analytics (non-blocking)
  console.log(`magic-login: source=${tokenData.source || 'unknown'} email=${tokenData.email}`);

  // Consume token (one-time use)
  try {
    await store.delete(token);
  } catch (err) {
    console.error('Failed to delete consumed token:', err);
    // Continue — session cookie is still valid
  }

  // Build session cookie
  let sessionCookie;
  try {
    sessionCookie = buildSessionCookie({
      email:      tokenData.email,
      firstName:  tokenData.firstName  || '',
      lastName:   tokenData.lastName   || '',
      faithStage: tokenData.faithStage || 'just_starting',
    });
  } catch (err) {
    console.error('Failed to build session cookie:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: errorPage('Server Error', 'Something went wrong. Please try again.'),
    };
  }

  // Redirect to course
  return {
    statusCode: 302,
    headers: {
      'Set-Cookie': sessionCookie,
      'Location':   'https://tochristforchrist.org/course.html',
    },
    body: '',
  };
};