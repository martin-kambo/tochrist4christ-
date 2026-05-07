// netlify/functions/log-activity.js
//
// Logs a community activity to Netlify Blobs.
// Called internally by other functions (signup, module complete, etc.)
// or from the frontend for prayer/testimony actions.
//
// POST body:
// {
//   type: 'signup' | 'module_complete' | 'prayer' | 'testimony' | 'streak',
//   name: string,          // first name or "Anonymous"
//   location: string,      // optional, e.g. "Nairobi"
//   meta: object           // optional extra data, e.g. { module: 2, streakDays: 7 }
// }

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Allowed activity types and their humanized message templates
// ---------------------------------------------------------------------------
const ACTIVITY_TEMPLATES = {
  signup: [
    '{name} just joined the discipleship journey.',
    '{name} from {location} took their first step today.',
    'Welcome {name} — a new believer has arrived.',
    '{name} just signed up. The journey begins.',
  ],
  module_complete: [
    '{name} completed Module {module}.',
    '{name} from {location} finished Module {module} today.',
    '{name} just unlocked Module {module}. Keep going.',
    'Module {module} — done. Well done, {name}.',
  ],
  prayer: [
    '{name} stopped to pray.',
    '{name} from {location} spent time in prayer.',
    'A prayer was lifted by {name}.',
    '{name} is interceding right now.',
  ],
  testimony: [
    '{name} shared a testimony.',
    '{name} from {location} has something to praise God for.',
    'A new testimony from {name}.',
    '{name} just shared what God has done.',
  ],
  streak: [
    '{name} is on a {streakDays}-day streak. 🔥',
    '{name} from {location} has been faithful for {streakDays} days straight.',
    '{streakDays} days of consistency — amazing, {name}.',
    '{name} — {streakDays} days strong. Keep it up.',
  ],
};

// ---------------------------------------------------------------------------
// Sanitize: strip HTML and limit length
// ---------------------------------------------------------------------------
function sanitize(str, maxLen = 60) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// Pick a random template and fill in variables
// ---------------------------------------------------------------------------
function buildMessage(type, data) {
  const templates = ACTIVITY_TEMPLATES[type];
  if (!templates) return null;
  const template = templates[Math.floor(Math.random() * templates.length)];
  return template
    .replace('{name}', data.name || 'Someone')
    .replace('{location}', data.location || 'Kenya')
    .replace('{module}', data.meta?.module || '1')
    .replace('{streakDays}', data.meta?.streakDays || '7');
}

// ---------------------------------------------------------------------------
// Blobs store helper
// ---------------------------------------------------------------------------
function getActivityStore() {
  const opts = { name: 'activities' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_BLOBS_TOKEN;
  }
  return getStore(opts);
}

// ---------------------------------------------------------------------------
// Rate limiting: max 1 activity per IP per type per 5 minutes
// (stored in Blobs under 'ratelimits' store)
// ---------------------------------------------------------------------------
async function isRateLimited(ip, type) {
  try {
    const opts = { name: 'ratelimits' };
    if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
      opts.siteID = process.env.NETLIFY_SITE_ID;
      opts.token = process.env.NETLIFY_BLOBS_TOKEN;
    }
    const store = getStore(opts);
    const key = `${ip}:${type}`;
    const existing = await store.get(key, { type: 'json' }).catch(() => null);
    if (existing && existing.ts && Date.now() - existing.ts < 5 * 60 * 1000) {
      return true; // within 5 minute window
    }
    await store.setJSON(key, { ts: Date.now() });
    return false;
  } catch {
    return false; // fail open — don't block legitimate activity
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { type, name, location, meta } = body;

  // Validate type
  if (!ACTIVITY_TEMPLATES[type]) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Invalid activity type. Must be one of: ${Object.keys(ACTIVITY_TEMPLATES).join(', ')}` }),
    };
  }

  // Sanitize inputs
  const cleanName = sanitize(name, 40) || 'Someone';
  const cleanLocation = sanitize(location, 40) || '';
  const cleanMeta = {
    module: meta?.module ? parseInt(meta.module, 10) : undefined,
    streakDays: meta?.streakDays ? parseInt(meta.streakDays, 10) : undefined,
  };

  // Rate limit by IP
  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (await isRateLimited(ip, type)) {
    return {
      statusCode: 429,
      body: JSON.stringify({ error: 'Too many requests. Please wait a few minutes.' }),
    };
  }

  // Build humanized message
  const message = buildMessage(type, { name: cleanName, location: cleanLocation, meta: cleanMeta });
  if (!message) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to build message' }) };
  }

  // Store activity
  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const activity = {
    id,
    type,
    message,
    name: cleanName,
    location: cleanLocation,
    meta: cleanMeta,
    ts: Date.now(),
    isoDate: new Date().toISOString(),
    hidden: false, // admin can set to true to hide from feed
  };

  try {
    const store = getActivityStore();
    await store.setJSON(id, activity);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id, message }),
    };
  } catch (err) {
    console.error('log-activity error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to save activity' }),
    };
  }
};