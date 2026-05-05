// netlify/functions/add-member.js
//
// Called by the signup form on index.html when a new member registers.
// Saves the member to Netlify Blobs so get-members.js can retrieve them.
//
// Expected POST body (JSON):
//   { name, email, phone, loc, source }
//
// Usage in index.html:
//   fetch('/.netlify/functions/add-member', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ name, email, phone, loc, source })
//   })

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Bad request' }) };
  }

  const { name, email, phone, loc, source } = body;

  // Basic validation
  if (!name || !name.trim()) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Name is required' }),
    };
  }

  // Build member record
  const id = crypto.randomUUID();
  const member = {
    id,
    name:     name.trim(),
    email:    (email || '').trim(),
    phone:    (phone || '').trim(),
    loc:      (loc || '').trim(),
    source:   (source || 'Direct').trim(),
    joined:   new Date().toLocaleDateString('en-KE', {
                day: 'numeric', month: 'short', year: 'numeric'
              }),
    joinedISO: new Date().toISOString(),   // used for sorting in admin
    status:   'new',
    progress: 0,
    module:   1,
  };

  try {
    const store = getStore('members');
    // Key is the UUID — unique per member, used by delete-member too
    await store.set(id, JSON.stringify(member));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id }),
    };
  } catch (err) {
    console.error('add-member error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Failed to save member' }),
    };
  }
};