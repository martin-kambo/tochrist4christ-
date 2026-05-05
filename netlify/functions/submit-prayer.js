// netlify/functions/submit-prayer.js
//
// Accepts a new prayer request, runs server-side moderation,
// and saves it to Netlify Blobs.
// Public — no auth required (anyone can submit a prayer).

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

// Server-side blocked words — cannot be bypassed by editing browser JS
const BLOCKED = [
  'spam','scam','casino','viagra','porn','xxx','hack','crack',
  'bitcoin','forex','invest now','click here','buy now','free money',
];

function moderate(text) {
  const lower = text.toLowerCase();
  for (const word of BLOCKED) {
    if (lower.includes(word)) return { ok: false, reason: 'Your prayer contains inappropriate content.' };
  }
  return { ok: true };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const VALID_CATEGORIES = ['general','healing','guidance','family','provision','salvation','gratitude'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Bad request' }) }; }

  const { name, text, category, anonymous } = body;

  // Validate
  if (!name || !name.trim()) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Name is required' }) };
  }
  if (!text || text.trim().length < 15) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Prayer must be at least 15 characters' }) };
  }
  if (text.trim().length > 500) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Prayer must be under 500 characters' }) };
  }

  const cat = VALID_CATEGORIES.includes(category) ? category : 'general';

  // Server-side moderation
  const mod = moderate(text);
  if (!mod.ok) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: mod.reason }) };
  }

  const id = 'prayer-' + crypto.randomUUID();
  const prayer = {
    id,
    name:      anonymous ? 'Anonymous' : escapeHtml(name.trim()),
    category:  cat,
    text:      escapeHtml(text.trim()),
    prayCount: 0,
    answered:  false,
    anonymous: !!anonymous,
    timestamp: Date.now(),
    isoDate:   new Date().toISOString(),
    // Store IP hash for basic rate-limiting (not exposed to frontend)
    ipHash:    crypto.createHash('sha256')
                 .update(event.headers['x-forwarded-for'] || 'unknown')
                 .digest('hex').slice(0, 16),
  };

  try {
    const store = getStore('prayers');
    await store.set(id, JSON.stringify(prayer));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id }),
    };
  } catch (err) {
    console.error('submit-prayer error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Could not save prayer. Please try again.' }),
    };
  }
};