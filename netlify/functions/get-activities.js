// netlify/functions/get-activities.js
//
// Returns the most recent community activities for the public feed.
// Filters out hidden activities (admin-moderated).
// Public — no authentication required.
//
// GET /.netlify/functions/get-activities?limit=10

const { getStore } = require('@netlify/blobs');

function getActivityStore() {
  const opts = { name: 'activities' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token = process.env.NETLIFY_BLOBS_TOKEN;
  }
  return getStore(opts);
}

// ---------------------------------------------------------------------------
// Relative time formatter — "2 minutes ago", "3 hours ago", etc.
// ---------------------------------------------------------------------------
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// Activity type to icon mapping
const TYPE_ICONS = {
  signup: '✝',
  module_complete: '📖',
  prayer: '🙏',
  testimony: '✨',
  streak: '🔥',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const limit = Math.min(parseInt(event.queryStringParameters?.limit || '10', 10), 50);

  try {
    const store = getActivityStore();
    const { blobs } = await store.list();

    // Fetch all activities in parallel
    const activities = await Promise.all(
      blobs.map(async ({ key }) => {
        try {
          return await store.get(key, { type: 'json' });
        } catch {
          return null;
        }
      })
    );

    const feed = activities
      .filter(Boolean)
      .filter((a) => !a.hidden) // exclude admin-hidden items
      .sort((a, b) => b.ts - a.ts) // newest first
      .slice(0, limit)
      .map((a) => ({
        id: a.id,
        type: a.type,
        message: a.message,
        timeAgo: timeAgo(a.ts),
        icon: TYPE_ICONS[a.type] || '✝',
        ts: a.ts,
      }));

    // Community stats
    const allVisible = activities.filter(Boolean).filter((a) => !a.hidden);
    const stats = {
      total: allVisible.length,
      prayers: allVisible.filter((a) => a.type === 'prayer').length,
      completions: allVisible.filter((a) => a.type === 'module_complete').length,
      members: allVisible.filter((a) => a.type === 'signup').length,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store', // always fresh
      },
      body: JSON.stringify({ feed, stats }),
    };
  } catch (err) {
    console.error('get-activities error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feed: [], stats: { total: 0, prayers: 0, completions: 0, members: 0 } }),
    };
  }
};