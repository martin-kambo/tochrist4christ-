// netlify/functions/add-member.js
// FIXED: Uses email-based key (consistent with send-welcome-email.js)
//        Saves all required fields (status, progress, phone, location, source)

const { getStore } = require('@netlify/blobs');

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

  const { name, email, phone, loc, source, faithStage } = body;

  if (!name || !name.trim()) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Name is required' }),
    };
  }

  if (!email || !email.trim()) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Email is required' }),
    };
  }

  // ✅ FIXED: Use email as key (base64url encoded, lowercase) — SAME as send-welcome-email.js
  const normalizedEmail = email.toLowerCase().trim();
  const key = Buffer.from(normalizedEmail).toString('base64url');

  // Parse name into firstName and lastName
  const nameParts = name.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  const now = new Date();
  const member = {
    // ✅ Core identity
    email: normalizedEmail,
    name: name.trim(),
    firstName,
    lastName,
    
    // ✅ Contact info
    phone: (phone || '').trim(),
    loc: (loc || '').trim(),
    
    // ✅ Signup info
    source: (source || 'Direct').trim(),
    faithStage: (faithStage || 'just_starting').trim(),
    
    // ✅ Timestamps (consistent with send-welcome-email.js)
    joined: now.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }),
    joinedISO: now.toISOString(),
    
    // ✅ Progress tracking
    status: 'new',
    progress: 0,
    module: 1,
  };

  try {
    const store = blobsStore('members');
    await store.setJSON(key, member);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, email: normalizedEmail }),
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