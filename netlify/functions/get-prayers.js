// netlify/functions/get-prayers.js
//
// Returns all prayer requests from Netlify Blobs.
// Public — no auth required.
// Always returns 200 — never breaks the prayer wall for visitors.

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const store     = getStore('prayers');
    const { blobs } = await store.list();

    if (!blobs || blobs.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
        body: JSON.stringify({ prayers: [] }),
      };
    }

    const prayers = await Promise.all(
      blobs.map(async ({ key }) => {
        try { return await store.get(key, { type: 'json' }); }
        catch { return null; }
      })
    );

    const valid = prayers
      .filter(Boolean)
      .map(({ ipHash, prayedIps, ...rest }) => rest) // strip internal fields
      .sort((a, b) => b.timestamp - a.timestamp);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
      body: JSON.stringify({ prayers: valid }),
    };

  } catch (err) {
    console.error('get-prayers error:', err);
    // Return 200 + empty array — never let this crash the prayer wall
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prayers: [] }),
    };
  }
};