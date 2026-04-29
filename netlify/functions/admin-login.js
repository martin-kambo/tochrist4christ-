const crypto = require('crypto');

const SECRET  = process.env.ADMIN_SESSION_SECRET || 'change-this-secret';
const PASSWORD = process.env.ADMIN_PASSWORD;

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return data + '.' + sig;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!PASSWORD) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ADMIN_PASSWORD env var not set' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { password } = body;

  // Constant-time comparison to prevent timing attacks
  const expected = Buffer.from(PASSWORD);
  const received = Buffer.from(password || '');
  const match = expected.length === received.length &&
    crypto.timingSafeEqual(expected, received);

  if (!match) {
    return {
      statusCode: 401,
      body: JSON.stringify({ success: false, error: 'Incorrect password' }),
    };
  }

  const token = signToken({ user: 'admin', iat: Date.now() });
  const cookieExpiry = new Date(Date.now() + 8 * 60 * 60 * 1000).toUTCString(); // 8 hours

  return {
    statusCode: 200,
    headers: {
      'Set-Cookie': `tc4c_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=${cookieExpiry}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ success: true, user: { name: 'Martin', role: 'admin' } }),
  };
};