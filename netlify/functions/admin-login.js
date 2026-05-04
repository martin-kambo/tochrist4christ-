// netlify/functions/admin-login.js
//
// Reads ADMIN_PASSWORD and SESSION_SECRET from Netlify environment variables.
// Neither value is ever sent to the browser.
//
// Set these in: Netlify Dashboard → Site → Environment variables
//   ADMIN_PASSWORD  — your chosen password (e.g. "MySecurePass2024!")
//   SESSION_SECRET  — a long random string (generate one at: randomkeygen.com)

const crypto = require('crypto');

// Build an HMAC-signed session token — no database needed.
// Format: base64(payload) + '.' + hmac-sha256(base64(payload), secret)
function createToken(secret) {
  const payload = Buffer.from(
    JSON.stringify({
      role: 'admin',
      // Token expires after 24 hours
      exp: Date.now() + 24 * 60 * 60 * 1000,
    })
  ).toString('base64url');

  const sig = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  return `${payload}.${sig}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const SESSION_SECRET = process.env.SESSION_SECRET;

  if (!ADMIN_PASSWORD || !SESSION_SECRET) {
    console.error('Missing ADMIN_PASSWORD or SESSION_SECRET env vars');
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Server misconfigured — contact administrator' }),
    };
  }

  let password;
  try {
    ({ password } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Bad request' }) };
  }

  // timingSafeEqual prevents timing-attack — both buffers must be same length
  const submitted = Buffer.alloc(ADMIN_PASSWORD.length);
  submitted.write(password || '');
  const expected = Buffer.from(ADMIN_PASSWORD);

  let match = false;
  try {
    match = crypto.timingSafeEqual(submitted, expected);
  } catch {
    // Different lengths — definitely wrong password
    match = false;
  }

  if (!match) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false }),
    };
  }

  const token = createToken(SESSION_SECRET);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      // HttpOnly — JS cannot read this cookie at all
      // SameSite=Strict — blocks CSRF attacks
      // Secure — only sent over HTTPS (Netlify always uses HTTPS)
      'Set-Cookie': `admin_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`,
    },
    body: JSON.stringify({ success: true, user: { role: 'admin' } }),
  };
};