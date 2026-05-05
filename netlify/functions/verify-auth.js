// netlify/functions/verify-auth.js
//
// Reads the HttpOnly session cookie set by admin-login and
// verifies its HMAC signature. Returns { authenticated: true/false }.
// The browser cannot forge this cookie without SESSION_SECRET.

const crypto = require('crypto');

function verifyToken(token, secret) {
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64url');

    // Constant-time compare — prevents timing attacks on the signature
    const sigBuffer = Buffer.from(sig);
    const expBuffer = Buffer.from(expectedSig);
    if (sigBuffer.length !== expBuffer.length) return null;
    if (!crypto.timingSafeEqual(sigBuffer, expBuffer)) return null;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    // Check expiry
    if (!data.exp || data.exp < Date.now()) return null;

    return data;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
}

exports.handler = async (event) => {
  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) {
    return {
      statusCode: 200,
      body: JSON.stringify({ authenticated: false }),
    };
  }

  const cookies = parseCookies(event.headers.cookie);
  const token = cookies['admin_session'];

  if (!token) {
    return {
      statusCode: 200,
      body: JSON.stringify({ authenticated: false }),
    };
  }

  const user = verifyToken(token, SESSION_SECRET);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      authenticated: !!user,
      // FIXED: Return user name and email for UI display
      user: user ? { role: 'admin', name: 'Martin', email: 'admin@tochristforchrist.org' } : null,
    }),
  };
};