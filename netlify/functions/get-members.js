// netlify/functions/get-members.js

const { getNetlifySubmissions } = require('./shared/netlify');

exports.handler = async (event) => {
  const cookies = parseCookies(event.headers.cookie || '');
  const sessionToken = cookies.admin_session;
  
  if (!sessionToken || sessionToken !== process.env.ADMIN_SESSION_TOKEN) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }
  
  try {
    const token = process.env.NETLIFY_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;
    
    if (!token || !siteId) {
      throw new Error('Netlify configuration missing');
    }
    
    const submissions = await getNetlifySubmissions(token, siteId);
    
    const members = submissions.map(sub => {
      const data = sub.data || {};
      const firstName = data.firstName || data.first_name || '';
      const lastName = data.lastName || data.last_name || '';
      const name = (firstName + ' ' + lastName).trim() || data.email || 'Anonymous';
      
      return {
        id: sub.id,
        name: name,
        email: data.email || '',
        loc: data.location || 'Unknown',
        joined: new Date(sub.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        progress: Math.floor(Math.random() * 100),
        module: Math.floor(Math.random() * 6) + 1,
        status: ['new', 'active', 'completed'][Math.floor(Math.random() * 3)],
        source: data.source || 'Unknown'
      };
    });
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members })
    };
  } catch (error) {
    console.error('Error fetching members:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch members' })
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