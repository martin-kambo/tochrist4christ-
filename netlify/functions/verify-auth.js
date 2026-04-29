const crypto = require('crypto');

const SECRET = process.env.ADMIN_SESSION_SECRET || 'change-this-secret';

function verifyToken(token) {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    if (sig !== expectedSig) return null;
    return JSON.parse(Buffer.from(data, 'base64url').toString());
  } catch {
    return null;
  }
}

function getTokenFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split('=');
    if (name.trim() === 'tc4c_admin') return rest.join('=');
  }
  return null;
}

exports.handler = async function (event) {
  const token = getTokenFromCookie(event.headers.cookie);
  if (!token) {
    return {
      statusCode: 200,
      body: JSON.stringify({ authenticated: false }),
    };
  }

  const payload = verifyToken(token);
  if (!payload) {
    return {
      statusCode: 200,
      body: JSON.stringify({ authenticated: false }),
    };
  }

  // Token expires after 8 hours
  if (Date.now() - payload.iat > 8 * 60 * 60 * 1000) {
    return {
      statusCode: 200,
      body: JSON.stringify({ authenticated: false }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ authenticated: true, user: { name: 'Martin', role: 'admin' } }),
  };
};