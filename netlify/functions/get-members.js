// netlify/functions/get-members.js
//
// Returns all members stored in Netlify Blobs.
// Protected — requires a valid admin session cookie (verified inline).
//
// Netlify Blobs docs: https://docs.netlify.com/blobs/overview/

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

// ── Reuse the same token verification logic as verify-auth.js ──
function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
}

function verifySession(event) {
  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) return false;
  const cookies = parseCookies(event.headers.cookie);
  const token = cookies['admin_session'];
  if (!token) return false;
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length) return false;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp && data.exp > Date.now();
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Auth check
  if (!verifySession(event)) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  try {
    const store = getStore('members');
    const { blobs } = await store.list();

    // Fetch each member record in parallel
    const members = await Promise.all(
      blobs.map(async ({ key }) => {
        const member = await store.get(key, { type: 'json' });
        return member;
      })
    );

    // Filter out any null/corrupt entries
    const valid = members.filter(Boolean);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: valid }),
    };
  } catch (err) {
    console.error('get-members error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to load members', members: [] }),
    };
  }
};