// netlify/functions/pray-for.js

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Bad request' }) }; }

  const { prayerId } = body;
  if (!prayerId)
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'prayerId required' }) };

  const ipHash = crypto.createHash('sha256')
    .update(event.headers['x-forwarded-for'] || 'unknown')
    .digest('hex').slice(0, 16);

  try {
    const storeOptions = {};
    if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
      storeOptions.siteID = process.env.NETLIFY_SITE_ID;
      storeOptions.token  = process.env.NETLIFY_BLOBS_TOKEN;
    }

    const store  = getStore({ name: 'prayers', ...storeOptions });
    const prayer = await store.get(prayerId, { type: 'json' });

    if (!prayer)
      return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Prayer not found' }) };

    const prayedIps = prayer.prayedIps || [];
    if (prayedIps.includes(ipHash)) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, prayCount: prayer.prayCount, alreadyPrayed: true }),
      };
    }

    prayer.prayCount = (prayer.prayCount || 0) + 1;
    prayer.prayedIps = [...prayedIps, ipHash];
    await store.set(prayerId, JSON.stringify(prayer));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, prayCount: prayer.prayCount }),
    };
  } catch (err) {
    console.error('pray-for error:', err.message, err.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message || 'Could not record prayer' }),
    };
  }
};