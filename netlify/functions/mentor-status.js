// netlify/functions/mentor-status.js
//
// V2 PHASE 3 — Returns the AUTHENTICATED caller's own canonical mentor
// status, plus their own application content if one exists.
//
// Status ('member' | 'mentor_pending' | 'mentor' | 'mentor_suspended')
// comes from the "members" Blobs record via shared/member-auth.js — it is
// never client-supplied and never derived from anything the browser sends.
// This is the one place a member can see where their own application
// stands; no other member's application is ever reachable from here.

const { getAuthenticatedMember } = require('./shared/member-auth');
const { getApplication } = require('./shared/mentor-store');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let member;
  try {
    member = await getAuthenticatedMember(event, { strict: true });
  } catch (err) {
    console.error('[mentor-status] Auth error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }
  if (!member) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let application = null;
  try {
    application = await getApplication(member.email);
  } catch (err) {
    console.error('[mentor-status] Storage error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ status: member.mentorStatus, application }),
  };
};
