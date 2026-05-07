// netlify/functions/moderate-activity.js
//
// Admin tool to hide or delete activities from the community feed.
// Protected — requires valid admin session cookie.
//
// POST body:
// { id: string, action: 'hide' | 'show' | 'delete' }

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

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

function getActivityStore() {
  const opts = { name: 'activities' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_BLOBS_TOKEN;
  }
  return getStore(opts);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!verifySession(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { id, action } = body;

  if (!id || !['hide', 'show', 'delete'].includes(action)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'id and action (hide|show|delete) are required' }),
    };
  }

  try {
    const store = getActivityStore();

    if (action === 'delete') {
      await store.delete(id);
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message: 'Activity deleted' }),
      };
    }

    // hide or show — update the record
    const activity = await store.get(id, { type: 'json' });
    if (!activity) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Activity not found' }) };
    }

    activity.hidden = action === 'hide';
    await store.setJSON(id, activity);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: `Activity ${action === 'hide' ? 'hidden' : 'restored'}` }),
    };
  } catch (err) {
    console.error('moderate-activity error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to moderate activity' }),
    };
  }
};