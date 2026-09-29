// netlify/functions/member-me.js
//
// V2 PHASE 1 — Canonical "who am I" endpoint for the member dashboard and
// other Phase 1 private surfaces.
//
// Identity is derived ONLY from the verified member_session cookie via
// shared/member-auth.js — never from a request body, query string, or
// localStorage value. Returns only what the member is entitled to see
// about themselves; never returns other members' data, admin-only data,
// storage keys, secrets, or tokens.
//
// GET /.netlify/functions/member-me
//   200 { member: { email, firstName, lastName, faithStage, joinedISO } }
//   401 { authenticated: false }               — no valid member_session
//   500 { error }                              — unexpected server error

const { getAuthenticatedMember } = require('./shared/member-auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache',
  };

  let member;
  try {
    member = await getAuthenticatedMember(event);
  } catch (err) {
    console.error('member-me error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }

  if (!member) {
    return { statusCode: 401, headers, body: JSON.stringify({ authenticated: false }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      member: {
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        faithStage: member.faithStage,
        joinedISO: member.joinedISO,
      },
    }),
  };
};
