// netlify/functions/pray-for.js
//
// Increments the prayCount on a prayer request.
// Public — no auth required.
// Basic IP-based rate limiting: one prayer-click per prayer per IP.

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
  if (!prayerId) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'prayerId required' }) };
  }

  // Hash the IP so we can detect duplicates without storing raw IPs
  const ipHash = crypto.createHash('sha256')
    .update(event.headers['x-forwarded-for'] || 'unknown')
    .digest('hex').slice(0, 16);

  try {
    const store  = getStore('prayers');
    const prayer = await store.get(prayerId, { type: 'json' });

    if (!prayer) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Prayer not found' }) };
    }

    // Idempotency: if this IP already prayed for this request, return success without incrementing
    const prayedIps = prayer.prayedIps || [];
    if (prayedIps.includes(ipHash)) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, prayCount: prayer.prayCount, alreadyPrayed: true }),
      };
    }

    prayer.prayCount  = (prayer.prayCount || 0) + 1;
    prayer.prayedIps  = [...prayedIps, ipHash];
    await store.set(prayerId, JSON.stringify(prayer));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, prayCount: prayer.prayCount }),
    };
  } catch (err) {
    console.error('pray-for error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Could not record prayer' }),
    };
  }
};