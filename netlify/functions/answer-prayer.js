// netlify/functions/answer-prayer.js
// Allows prayer submitters to mark their prayer as answered with testimony

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Bad request' }) }; }

  const { prayerId, testimony, userEmail } = body;

  // ── VALIDATION ──────────────────────────────────────────────
  if (!prayerId || !testimony || !userEmail) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Missing required fields: prayerId, testimony, userEmail' }),
    };
  }

  const cleanTestimony = String(testimony).trim();
  const cleanEmail = String(userEmail).trim().toLowerCase();

  if (cleanTestimony.length < 10 || cleanTestimony.length > 500) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Testimony must be 10-500 characters' }),
    };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Invalid email format' }),
    };
  }

  try {
    // ── GET THE PRAYER ──────────────────────────────────────────
    const storeOptions = {};
    if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
      storeOptions.siteID = process.env.NETLIFY_SITE_ID;
      storeOptions.token  = process.env.NETLIFY_BLOBS_TOKEN;
    }

    const store = getStore({ name: 'prayers', ...storeOptions });
    const prayer = await store.get(prayerId, { type: 'json' });

    if (!prayer) {
      return {
        statusCode: 404,
        body: JSON.stringify({ success: false, error: 'Prayer not found' }),
      };
    }

    // ── VERIFY OWNERSHIP ────────────────────────────────────────
    const submitterEmail = String(prayer.submitterEmail || '').trim().toLowerCase();

    if (submitterEmail !== cleanEmail) {
      return {
        statusCode: 403,
        body: JSON.stringify({ 
          success: false,
          error: 'Unauthorized - only the prayer submitter can answer this prayer'
        }),
      };
    }

    // ── CHECK IF ALREADY ANSWERED ──────────────────────────────
    if (prayer.answered === true) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false,
          error: 'This prayer has already been marked as answered'
        }),
      };
    }

    // ── UPDATE THE PRAYER ──────────────────────────────────────
    const updatedPrayer = {
      ...prayer,
      answered: true,
      answeredTestimony: cleanTestimony,
      answeredAt: new Date().toISOString(),
    };

    await store.set(prayerId, JSON.stringify(updatedPrayer));

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        prayerId: prayerId,
        answered: true,
        message: 'Prayer marked as answered. Your testimony will encourage the community!',
      }),
    };

  } catch (err) {
    console.error('answer-prayer error:', err.message, err.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false,
        error: err.message || 'Could not save answer'
      }),
    };
  }
};