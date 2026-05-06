// netlify/functions/submit-prayer.js

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

const VALID_CATEGORIES = ['general','healing','guidance','family','provision','salvation','gratitude'];

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Bad request' }) }; }

  const { name, text, category, anonymous } = body;

  if (!name || !name.trim())
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Name is required' }) };
  if (!text || text.trim().length < 15)
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Prayer must be at least 15 characters' }) };
  if (text.trim().length > 500)
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Prayer must be under 500 characters' }) };

  const cat = VALID_CATEGORIES.includes(category) ? category : 'general';
  const mod = moderate(text);
  if (!mod.ok)
    return { statusCode: 400, body: JSON.stringify({ success: false, error: mod.reason }) };

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
    ipHash:    crypto.createHash('sha256')
                 .update(event.headers['x-forwarded-for'] || 'unknown')
                 .digest('hex').slice(0, 16),
  };

  try {
    // Pass siteID and token explicitly — required on some Netlify tiers
    // where the context is not automatically injected into getStore()
    const storeOptions = {};
    if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
      storeOptions.siteID = process.env.NETLIFY_SITE_ID;
      storeOptions.token  = process.env.NETLIFY_BLOBS_TOKEN;
    }

    const store = getStore({ name: 'prayers', ...storeOptions });
    await store.set(id, JSON.stringify(prayer));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id }),
    };
  } catch (err) {
    // Log the FULL error so it appears in Netlify function logs
    console.error('submit-prayer Blobs error:', err.message, err.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message || 'Could not save prayer. Please try again.' }),
    };
  }
};