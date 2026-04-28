// netlify/functions/admin-logout.js

exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: {
      'Set-Cookie': `admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ success: true })
  };
};