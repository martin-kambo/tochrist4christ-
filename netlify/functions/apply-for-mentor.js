// netlify/functions/apply-for-mentor.js
//
// V2 PHASE 3 — Submits (or, while still pending, updates) the
// AUTHENTICATED caller's own mentor application.
//
// Security model (matches every Phase 1/2 private endpoint):
//   - Requires a valid member_session cookie (shared/member-auth.js).
//   - Identity is derived SOLELY from that session — there is no email
//     field in the accepted body at all.
//
// Status transition rules (see TC4C_V2_PHASE3_ARCHITECTURE.md
// §"Mentor application workflow" for the full reasoning):
//   member            → creates a new pending application (201)
//   mentor_pending     → updates the existing pending application's
//                        content in place (200) — the same member editing
//                        their own not-yet-decided submission is safe
//   mentor             → 409, already an approved mentor
//   mentor_suspended   → 409, cannot self-reapply around a suspension
//
// A storage read failure during this check fails the whole request (500)
// rather than being treated as "member, go ahead" — see shared/
// mentor-store.js's fail-closed contract.

const { getAuthenticatedMember, setMentorStatus } = require('./shared/member-auth');
const { validateApplicationInput, upsertPendingApplication } = require('./shared/mentor-store');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let member;
  try {
    member = await getAuthenticatedMember(event, { strict: true });
  } catch (err) {
    console.error('[apply-for-mentor] Auth error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }
  if (!member) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (member.mentorStatus === 'mentor') {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'You are already an approved mentor.' }) };
  }
  if (member.mentorStatus === 'mentor_suspended') {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'Your mentor status is suspended. Please contact an administrator.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const validation = validateApplicationInput(body);
  if (!validation.ok) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: validation.error }) };
  }

  const isResubmit = member.mentorStatus === 'mentor_pending';

  let application;
  try {
    application = await upsertPendingApplication(member.email, validation.value);
    if (!isResubmit) {
      await setMentorStatus(member.email, 'mentor_pending');
    }
  } catch (err) {
    console.error('[apply-for-mentor] Storage error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }

  return {
    statusCode: isResubmit ? 200 : 201,
    headers,
    body: JSON.stringify({ success: true, application }),
  };
};
