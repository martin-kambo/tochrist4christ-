// netlify/functions/add-member.js

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Bad request' }) }; }

  const { name, email, phone, loc, source } = body;

  if (!name || !name.trim()) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Name is required' }),
    };
  }

  const id = crypto.randomUUID();
  const member = {
    id,
    name:      name.trim(),
    email:     (email || '').trim(),
    phone:     (phone || '').trim(),
    loc:       (loc || '').trim(),
    source:    (source || 'Direct').trim(),
    joined:    new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }),
    joinedISO: new Date().toISOString(),
    status:    'new',
    progress:  0,
    module:    1,
  };

  try {
    const store = blobsStore('members');
    await store.set(id, JSON.stringify(member));
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id }),
    };
  } catch (err) {
    console.error('add-member error:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message || 'Failed to save member' }),
    };
  }
};