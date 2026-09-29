// netlify/functions/mentor-profile.js
//
// V2 PHASE 3 — Read/write the AUTHENTICATED caller's OWN mentor profile.
// Mentor-only: requires member.mentorStatus === 'mentor'.
//
// This is deliberately the one Phase 3 endpoint that enforces
// requireMentor() semantics (see TC4C_V2_PHASE3_ARCHITECTURE.md
// §"Authorization model"):
//   - anonymous                → 401
//   - member                   → 403 (not a mentor)
//   - mentor_pending           → 403 (not approved yet)
//   - mentor_suspended         → 403 (no longer has mentor permissions)
//   - mentor                   → 200/OK
//
// GET  → the caller's own profile (or a well-formed "no profile yet" shape)
// POST → validates and upserts the caller's own profile

const { getAuthenticatedMember } = require('./shared/member-auth');
const { validateProfileInput, getProfile, upsertProfile } = require('./shared/mentor-store');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let member;
  try {
    member = await getAuthenticatedMember(event, { strict: true });
  } catch (err) {
    console.error('[mentor-profile] Auth error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }
  if (!member) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // requireMentor() — a pending applicant or a suspended mentor gets 403,
  // exactly like an ordinary member. Only an approved mentor passes.
  if (member.mentorStatus !== 'mentor') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Mentor access required.' }) };
  }

  if (event.httpMethod === 'GET') {
    let profile;
    try {
      profile = await getProfile(member.email);
    } catch (err) {
      console.error('[mentor-profile] Storage error:', err.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ profile }) }; // profile is null if never saved yet
  }

  // POST
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const validation = validateProfileInput(body);
  if (!validation.ok) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: validation.error }) };
  }

  let profile;
  try {
    profile = await upsertProfile(member.email, validation.value);
  } catch (err) {
    console.error('[mentor-profile] Storage error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true, profile }) };
};
