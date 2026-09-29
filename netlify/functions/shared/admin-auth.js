// netlify/functions/shared/admin-auth.js
//
// V2 PHASE 3 — shared admin-session verification helper.
//
// This is NOT a new admin authentication system. It is the exact same
// admin_session HMAC-cookie check that already exists, independently
// copy-pasted, in seven other files (verify-auth.js, get-members.js,
// export-members.js, mark-answered.js, delete-prayer.js,
// moderate-activity.js, send-email.js — see TC4C_TECHNICAL_FINDINGS.md
// H10). Rather than adding an EIGHTH inline copy for the two new Phase 3
// admin mentor-review endpoints, this extracts it once, following the
// same precedent already set by shared/member-auth.js for the member
// session.
//
// Per change discipline (Phase 3 brief §26 — do not refactor unrelated
// code), the seven existing files are NOT modified to use this helper;
// they keep their own inline copies exactly as they are. Only the two new
// Phase 3 admin endpoints (admin-mentor-applications.js,
// admin-mentor-application-action.js) use this file.
//
// Required env var (unchanged): SESSION_SECRET — same key admin-login.js
// signs the admin_session cookie with.

const crypto = require('crypto');

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
}

/**
 * Verifies the admin_session cookie. Returns true/false — never throws,
 * never trusts anything but the signed cookie (no adminEmail body field,
 * no query string, no header other than Cookie itself).
 */
function isAuthenticatedAdmin(event) {
  const SECRET = process.env.SESSION_SECRET;
  if (!SECRET) return false;

  const cookieHeader = (event.headers && (event.headers.cookie || event.headers.Cookie)) || '';
  const token = parseCookies(cookieHeader)['admin_session'];
  if (!token) return false;

  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;

    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Boolean(data.exp && data.exp > Date.now()); // fail closed on missing/expired exp
  } catch {
    return false; // fail closed — malformed cookie is never treated as authenticated
  }
}

module.exports = { isAuthenticatedAdmin };

// Not a callable endpoint — same guard pattern as the other shared/ helpers.
exports.handler = async () => ({
  statusCode: 404,
  body: JSON.stringify({ error: 'Not a callable endpoint.' }),
});
