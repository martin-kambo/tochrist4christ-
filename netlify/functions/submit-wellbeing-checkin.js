// netlify/functions/submit-wellbeing-checkin.js
//
// V2 PHASE 1 — Creates a new wellbeing check-in for the AUTHENTICATED
// caller only. This is the write side of the wellbeing feature described
// in the Phase 1 brief (Parts G–J).
//
// Security model (see TC4C_V2_PHASE1_ARCHITECTURE.md and Part H/I of the
// brief):
//   - Requires a valid member_session cookie (see shared/member-auth.js).
//   - The member identity is derived SOLELY from that verified session —
//     never from a request body field. There is no `email` field in the
//     accepted request body at all; if one is sent, it is ignored.
//   - Every stored entry's `visibility` is hardcoded to 'private' by
//     shared/wellbeing-store.js, regardless of what the client sends.
//     No mentor/admin visibility exists in this phase (Part N of the
//     brief) — this endpoint cannot be used to share a check-in with
//     anyone else.
//   - Input is validated server-side against fixed enums; free-text
//     reflection is HTML-escaped and length-bounded
//     (see shared/wellbeing-store.js MAX_REFLECTION_LENGTH).
//
// This is NOT a diagnostic tool. It records a member's own reflection; it
// does not calculate scores, assign clinical labels, or perform any
// automated assessment.
//
// ── Request ──────────────────────────────────────────────────────────────────
// POST (member_session cookie required) {
//   emotionalState    : one of 'struggling' | 'not_great' | 'okay' | 'good' | 'doing_well'
//   primaryConcern    : one of 'faith' | 'family' | 'relationships' | 'work' |
//                       'school' | 'finances' | 'loneliness' | 'stress' |
//                       'grief' | 'purpose' | 'other' | 'prefer_not_to_say'
//   reflection        : string, optional, up to 1000 characters
//   supportPreference : one of 'keep_private' | 'encouragement' |
//                       'talk_to_someone' | 'resources'
// }
//
// ── Responses ────────────────────────────────────────────────────────────────
// 201 { success: true, entry: { id, createdAt, date, emotionalState,
//                                primaryConcern, reflection,
//                                supportPreference, visibility } }
// 400 { error: '<validation message>' }
// 401 { error: 'Unauthorized' }
// 405 { error: 'Method not allowed' }
// 500 { error: 'internal error' }

const { getAuthenticatedMember } = require('./shared/member-auth');
const { validateCheckInInput, appendEntry } = require('./shared/wellbeing-store');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Authenticate: identity comes ONLY from the verified session ───────────
  let member;
  try {
    member = await getAuthenticatedMember(event);
  } catch (err) {
    console.error('[submit-wellbeing-checkin] Auth error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }
  if (!member) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // ── Parse + validate body ──────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const validation = validateCheckInInput(body);
  if (!validation.ok) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: validation.error }) };
  }

  // ── Persist (email is the authenticated member's own — never client input) ─
  let entry;
  try {
    entry = await appendEntry(member.email, validation.value);
  } catch (err) {
    console.error('[submit-wellbeing-checkin] Storage error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }

  return { statusCode: 201, headers, body: JSON.stringify({ success: true, entry }) };
};
