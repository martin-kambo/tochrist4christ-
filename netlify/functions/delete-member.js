// netlify/functions/delete-member.js

const { deleteNetlifySubmission } = require('./shared/netlify');

exports.handler = async (event) => {
  if (event.httpMethod !== 'DELETE') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  const cookies = parseCookies(event.headers.cookie || '');
  const sessionToken = cookies.admin_session;
  
  if (!sessionToken || sessionToken !== process.env.ADMIN_SESSION_TOKEN) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }
  
  try {
    const { memberId } = JSON.parse(event.body);
    
    if (!memberId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Member ID required' })
      };
    }
    
    const success = await deleteNetlifySubmission(process.env.NETLIFY_TOKEN, memberId);
    
    if (success) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true })
      };
    } else {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Member not found' })
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to delete member' })
    };
  }
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