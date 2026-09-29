// netlify/functions/admin-mentor-applications.js
//
// V2 PHASE 3 — Admin-only listing of mentor applications.
//
// Uses shared/admin-auth.js (the extracted, existing admin_session check —
// see that file's own header comment for why this is not a second admin
// auth system). No client-supplied adminEmail is ever consulted, and
// there is no fail-open path: any error verifying the session, or any
// storage read failure, returns an error response — never a silent
// "here are the applications anyway."
//
// GET ?status=pending|approved|rejected|suspended|all   (default: pending)

const { isAuthenticatedAdmin } = require('./shared/admin-auth');
const { listApplications, APPLICATION_STATUSES } = require('./shared/mentor-store');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!isAuthenticatedAdmin(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const statusFilter = (event.queryStringParameters && event.queryStringParameters.status) || 'pending';
  if (statusFilter !== 'all' && !APPLICATION_STATUSES.includes(statusFilter)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `status must be one of: all, ${APPLICATION_STATUSES.join(', ')}` }) };
  }

  let applications;
  try {
    applications = await listApplications();
  } catch (err) {
    console.error('[admin-mentor-applications] Storage error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
  }

  const filtered = statusFilter === 'all' ? applications : applications.filter((a) => a.status === statusFilter);

  return { statusCode: 200, headers, body: JSON.stringify({ applications: filtered }) };
};
