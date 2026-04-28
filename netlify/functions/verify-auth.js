// netlify/functions/verify-auth.js

exports.handler = async (event) => {
  const cookies = parseCookies(event.headers.cookie || '');
  const sessionToken = cookies.admin_session;
  
  const validSession = sessionToken && sessionToken === process.env.ADMIN_SESSION_TOKEN;
  
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      authenticated: validSession,
      user: validSession ? { name: 'Admin' } : null
    })
  };
};

function parseCookies(cookieString) {
  const cookies = {};
  if (!cookieString) return cookies;
  
  cookieString.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    cookies[name] = value;
  });
  
  return cookies;
}