const crypto = require('crypto');

const SECRET    = process.env.ADMIN_SESSION_SECRET || 'change-this-secret';
const API_TOKEN = process.env.NETLIFY_API_TOKEN;

function verifyToken(token) {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (Date.now() - payload.iat > 8 * 60 * 60 * 1000) return null;
    return payload;
  } catch { return null; }
}

function getTokenFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const c of cookies) {
    const [name, ...rest] = c.split('=');
    if (name.trim() === 'tc4c_admin') return rest.join('=');
  }
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'DELETE') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const token = getTokenFromCookie(event.headers.cookie);
  if (!verifyToken(token)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { memberId } = body;
  if (!memberId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'memberId required' }) };
  }

  try {
    const response = await fetch(
      `https://api.netlify.com/api/v1/submissions/${memberId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      }
    );

    if (!response.ok && response.status !== 204) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Failed to delete from Netlify' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('delete-member error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};