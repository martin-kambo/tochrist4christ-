// netlify/functions/admin-login.js
//
// Reads ADMIN_PASSWORD_HASH and SESSION_SECRET from Netlify environment variables.
// ADMIN_PASSWORD_HASH is a SHA-256 hex digest of your password.
// The plain password never needs to be stored anywhere.

const crypto = require('crypto');

function createToken(secret) {
  const payload = Buffer.from(
    JSON.stringify({
      role: 'admin',
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

  const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
  const SESSION_SECRET = process.env.SESSION_SECRET;

  if (!ADMIN_PASSWORD_HASH || !SESSION_SECRET) {
    console.error('Missing ADMIN_PASSWORD_HASH or SESSION_SECRET env vars');
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

  // Hash the submitted password with SHA-256 and compare against stored hash
  const submittedHash = crypto
    .createHash('sha256')
    .update(password || '')
    .digest('hex');

  // Timing-safe compare — prevents brute-force timing attacks
  const submittedBuffer = Buffer.from(submittedHash);
  const storedBuffer   = Buffer.from(ADMIN_PASSWORD_HASH);

  let match = false;
  try {
    match = submittedBuffer.length === storedBuffer.length &&
            crypto.timingSafeEqual(submittedBuffer, storedBuffer);
  } catch {
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
      'Set-Cookie': `admin_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`,
    },
    body: JSON.stringify({ success: true, user: { role: 'admin' } }),
  };
};