// netlify/functions/get-prayers.js

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const storeOptions = {};
    if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
      storeOptions.siteID = process.env.NETLIFY_SITE_ID;
      storeOptions.token  = process.env.NETLIFY_BLOBS_TOKEN;
    }

    const store     = getStore({ name: 'prayers', ...storeOptions });
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
      .map(({ ipHash, prayedIps, ...rest }) => rest)
      .sort((a, b) => b.timestamp - a.timestamp);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
      body: JSON.stringify({ prayers: valid }),
    };

  } catch (err) {
    console.error('get-prayers error:', err.message, err.stack);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prayers: [] }),
    };
  }
};