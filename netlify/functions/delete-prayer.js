// netlify/functions/delete-prayer.js
//
// Permanently deletes a prayer request from Netlify Blobs.
// Protected — requires valid admin session cookie.

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

function parseCookies(h = '') {
  return Object.fromEntries(h.split(';').map(c => { const [k,...v]=c.trim().split('='); return [k,v.join('=')]; }));
}
function verifySession(event) {
  const SECRET = process.env.SESSION_SECRET;
  if (!SECRET) return false;
  const token = parseCookies(event.headers.cookie)['admin_session'];
  if (!token) return false;
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const exp = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
    const sb = Buffer.from(sig), eb = Buffer.from(exp);
    if (sb.length !== eb.length) return false;
    if (!crypto.timingSafeEqual(sb, eb)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp && data.exp > Date.now();
  } catch { return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'DELETE') return { statusCode: 405, body: 'Method Not Allowed' };
  if (!verifySession(event)) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Bad request' }) }; }

  const { prayerId } = body;
  if (!prayerId) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'prayerId required' }) };

  try {
    const store = getStore('prayers');
    await store.delete(prayerId);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('delete-prayer error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Could not delete prayer' }) };
  }
};