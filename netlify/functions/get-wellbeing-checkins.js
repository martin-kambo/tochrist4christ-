// netlify/functions/get-wellbeing-checkins.js
//
// V2 PHASE 1 — Returns the AUTHENTICATED caller's OWN wellbeing
// check-ins, newest first. This is the read side of the wellbeing
// feature described in the Phase 1 brief (Parts G–I).
//
// Security model (see TC4C_V2_PHASE1_ARCHITECTURE.md and Part I of the
// brief):
//   - Requires a valid member_session cookie (see shared/member-auth.js).
//   - The member identity is derived SOLELY from that verified session —
//     there is no email/memberId query parameter on this endpoint at all.
//   - Only ever returns the caller's own records. There is no admin/mentor
//     variant of this endpoint in this phase (Part N of the brief) — an
//     admin session cannot use this endpoint to read a member's check-ins.
//   - A private wellbeing reflection is therefore never reachable by any
//     endpoint other than this one, and only by its owner.
//
// ── Request ──────────────────────────────────────────────────────────────────
// GET (member_session cookie required)
//   ?limit=20   optional, default 20, max 100 — most recent N entries
//
// ── Responses ────────────────────────────────────────────────────────────────
// 200 { success: true, entries: [ {id, createdAt, date, emotionalState,
//                                  primaryConcern, reflection,
//                                  supportPreference, visibility}, ... ] }
// 401 { error: 'Unauthorized' }
// 405 { error: 'Method not allowed' }
// 500 { error: 'internal error' }

const { getAuthenticatedMember } = require('./shared/member-auth');
const { getRecord } = require('./shared/wellbeing-store');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Authenticate: identity comes ONLY from the verified session ───────────
  let member;
  try {
    member = await getAuthenticatedMember(event);
  } catch (err) {
    console.error('[get-wellbeing-checkins] Auth error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }
  if (!member) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const rawLimit = Number(event.queryStringParameters?.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
    : DEFAULT_LIMIT;

  let record;
  try {
    record = await getRecord(member.email);
  } catch (err) {
    console.error('[get-wellbeing-checkins] Storage error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }

  const entries = [...(record.entries || [])]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) // newest first
    .slice(0, limit);

  return { statusCode: 200, headers, body: JSON.stringify({ success: true, entries }) };
};
