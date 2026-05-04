// netlify/functions/admin-logout.js
//
// Clears the admin session cookie by setting Max-Age=0.
// Because the cookie is HttpOnly, JavaScript cannot delete it directly —
// only the server can, which is exactly why HttpOnly is secure.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
    },
    body: JSON.stringify({ success: true }),
  };
};