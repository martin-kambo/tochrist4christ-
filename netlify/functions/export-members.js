// netlify/functions/export-members.js

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
    const submissions = await getNetlifySubmissions(process.env.NETLIFY_TOKEN, process.env.NETLIFY_SITE_ID);
    
    let csv = 'Name,Email,Location,Joined Date,Source\n';
    
    submissions.forEach(sub => {
      const data = sub.data || {};
      const firstName = data.firstName || data.first_name || '';
      const lastName = data.lastName || data.last_name || '';
      const name = (firstName + ' ' + lastName).trim() || data.email || 'Anonymous';
      
      csv += `"${name}","${data.email || ''}","${data.location || ''}","${new Date(sub.created_at).toLocaleDateString()}","${data.source || ''}"\n`;
    });
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="members-export.csv"'
      },
      body: csv
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to export members' })
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