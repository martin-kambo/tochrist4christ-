// netlify/functions/admin-mentor-application-action.js
//
// V2 PHASE 3 — Admin-only approve/reject/suspend action on a member's
// mentor application. Uses shared/admin-auth.js — see that file and
// admin-mentor-applications.js's header comment for why this is not a
// new/second admin authentication system, and why there is no fail-open
// path here.
//
// POST { email, action: 'approve' | 'reject' | 'suspend', note? }
//
// The target member is identified by email in the body — this is
// legitimate here (unlike every member-private endpoint elsewhere in this
// codebase) because the caller is an already-verified admin acting ON
// another member, exactly the same pattern delete-member.js and
// mark-answered.js already use. It is never used to establish the
// CALLER's own identity.
//
// Effects (see TC4C_V2_PHASE3_ARCHITECTURE.md §"Mentor application
// workflow" for the full state-machine reasoning):
//   approve → application.status = 'approved', members.mentorStatus = 'mentor'
//   reject  → application.status = 'rejected', members.mentorStatus = 'member'
//   suspend → ONLY valid when the member is currently an approved mentor;
//             application.status = 'suspended', members.mentorStatus = 'mentor_suspended'
//
// "Reinstate" is deliberately NOT implemented — the Phase 3 brief asks
// only for approve/reject/suspend-or-revoke; a path back from suspension
// is left for a future phase rather than added here as unrequested scope.
//
// This writes to two stores (the application record and the member
// record) — not a single atomic transaction. Write order is chosen so a
// partial failure always fails SAFE (revoke first, grant last — see the
// comment at the write site) and every half-completed action can be
// safely re-run, matching the same
// two-independent-writes pattern already present elsewhere in this
// codebase (e.g. add-member.js / send-welcome-email.js both writing the
// "members" store independently). See the changelog's "Known
// limitations" for why this is accepted rather than engineered around in
// a small foundation phase.

const { isAuthenticatedAdmin } = require('./shared/admin-auth');
const { getMemberRecord, setMentorStatus } = require('./shared/member-auth');
const { getApplication, setApplicationStatus, MENTOR_ACTIONS } = require('./shared/mentor-store');

const ACTION_TO_MENTOR_STATUS = {
  approve: 'mentor',
  reject: 'member',
  suspend: 'mentor_suspended',
};
const ACTION_TO_APPLICATION_STATUS = {
  approve: 'approved',
  reject: 'rejected',
  suspend: 'suspended',
};

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!isAuthenticatedAdmin(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const email = String(body.email || '').trim().toLowerCase();
  const action = String(body.action || '').trim();
  const note = body.note;

  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'email is required' }) };
  }
  if (!MENTOR_ACTIONS.includes(action)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `action must be one of: ${MENTOR_ACTIONS.join(', ')}` }) };
  }

  let targetMember;
  try {
    targetMember = await getMemberRecord(email);
  } catch (err) {
    console.error('[admin-mentor-application-action] Member lookup error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }
  if (!targetMember) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'No member found for that email' }) };
  }

  // ── State machine (see TC4C_V2_PHASE3_ARCHITECTURE.md) ────────────────────
  //   approve / reject : member must not already be an approved or
  //                      suspended mentor, and there must be an application
  //                      awaiting a decision. Because "approve" is refused
  //                      for a suspended mentor, approve can never act as
  //                      an unrequested "reinstate".
  //   suspend          : only meaningful for a currently approved mentor.
  // The 'approved'/'rejected' application statuses are also accepted for
  // approve/reject respectively so an admin can safely RE-RUN an action
  // that half-completed (application written, member record not) — the
  // two-write, non-atomic pattern noted in the header comment.
  const memberStatus = targetMember.mentorStatus || 'member';

  if (action === 'suspend') {
    if (memberStatus === 'mentor_suspended') {
      // Only allowed to RE-RUN a half-completed suspend (member record
      // already revoked, application record still says 'approved'). A
      // suspend of someone already fully suspended is a 409.
      let existingApplication;
      try {
        existingApplication = await getApplication(email);
      } catch (err) {
        console.error('[admin-mentor-application-action] Application lookup error:', err.message);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
      }
      if (!existingApplication || existingApplication.status !== 'approved') {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'This mentor is already suspended.' }) };
      }
    } else if (memberStatus !== 'mentor') {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Only a currently approved mentor can be suspended.' }) };
    }
  } else {
    if (memberStatus === 'mentor' || memberStatus === 'mentor_suspended') {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'This member is already an approved or suspended mentor; approve/reject does not apply.' }) };
    }
    let existingApplication;
    try {
      existingApplication = await getApplication(email);
    } catch (err) {
      console.error('[admin-mentor-application-action] Application lookup error:', err.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
    }
    if (!existingApplication) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No mentor application exists for that member.' }) };
    }
    const allowedApplicationStates = action === 'approve' ? ['pending', 'approved'] : ['pending', 'rejected'];
    if (!allowedApplicationStates.includes(existingApplication.status)) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: `Application is already ${existingApplication.status}; cannot ${action}.` }) };
    }
  }

  let application;
  try {
    // Write ordering principle: the write that REVOKES permission happens
    // first, the write that GRANTS permission happens last. So a failure
    // between the two writes can never leave someone holding mentor
    // permission the admin meant to take away, nor grant permission that
    // wasn't fully recorded.
    //   suspend       → member record first (revokes access), then application
    //   approve/reject → application first, then member record (approve grants last)
    if (action === 'suspend') {
      await setMentorStatus(email, ACTION_TO_MENTOR_STATUS[action]);
      application = await setApplicationStatus(email, ACTION_TO_APPLICATION_STATUS[action], note);
    } else {
      application = await setApplicationStatus(email, ACTION_TO_APPLICATION_STATUS[action], note);
      await setMentorStatus(email, ACTION_TO_MENTOR_STATUS[action]);
    }
  } catch (err) {
    console.error('[admin-mentor-application-action] Storage error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true, application }) };
};
