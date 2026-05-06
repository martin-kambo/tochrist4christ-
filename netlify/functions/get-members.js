// netlify/functions/get-members.js

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

function blobsStore(name) {
  const opts = { name };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_BLOBS_TOKEN;
  }
  return getStore(opts);
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
}

function verifySession(event) {
  const SECRET = process.env.SESSION_SECRET;
  if (!SECRET) return false;
  const token = parseCookies(event.headers.cookie)['admin_session'];
  if (!token) return false;
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
    const sb = Buffer.from(sig), eb = Buffer.from(expected);
    if (sb.length !== eb.length) return false;
    if (!crypto.timingSafeEqual(sb, eb)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp && data.exp > Date.now();
  } catch { return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };
  if (!verifySession(event)) {
    return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const store = blobsStore('members');
    const { blobs } = await store.list();
    const members = await Promise.all(
      blobs.map(async ({ key }) => {
        try { return await store.get(key, { type: 'json' }); }
        catch { return null; }
      })
    );
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: members.filter(Boolean) }),
    };
  } catch (err) {
    console.error('get-members error:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to load members', members: [] }),
    };
  }
};