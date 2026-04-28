// netlify/functions/get-members.js

exports.handler = async (event) => {
  // Debug: Log the request
  console.log('Get members function called');
  
  // Check authentication from cookie
  const cookies = parseCookies(event.headers.cookie || '');
  const sessionToken = cookies.admin_session;
  
  console.log('Session token present:', !!sessionToken);
  console.log('Expected token present:', !!process.env.ADMIN_SESSION_TOKEN);
  
  if (!sessionToken || sessionToken !== process.env.ADMIN_SESSION_TOKEN) {
    console.log('Authentication failed');
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }
  
  try {
    const token = process.env.NETLIFY_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;
    
    if (!token || !siteId) {
      console.error('Missing Netlify configuration:', { hasToken: !!token, hasSiteId: !!siteId });
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Netlify configuration missing on server' })
      };
    }
    
    // First, get all forms for this site
    console.log('Fetching forms from Netlify...');
    const formsRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!formsRes.ok) {
      console.error('Forms API error:', formsRes.status);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Netlify API error: ${formsRes.status}` })
      };
    }
    
    const forms = await formsRes.json();
    console.log('Found forms:', forms.map(f => f.name));
    
    // Find the signup form
    const signupForm = forms.find(f => f.name === 'signup');
    
    if (!signupForm) {
      console.log('No signup form found - returning empty array');
      return {
        statusCode: 200,
        body: JSON.stringify({ members: [] })
      };
    }
    
    // Get submissions
    console.log('Fetching submissions from form:', signupForm.id);
    const subsRes = await fetch(`https://api.netlify.com/api/v1/forms/${signupForm.id}/submissions?per_page=100`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!subsRes.ok) {
      console.error('Submissions API error:', subsRes.status);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Failed to fetch submissions: ${subsRes.status}` })
      };
    }
    
    const submissions = await subsRes.json();
    console.log('Found submissions:', submissions.length);
    
    // Transform submissions into member objects
    const members = submissions.map(sub => {
      const data = sub.data || {};
      const firstName = data.firstName || data.first_name || '';
      const lastName = data.lastName || data.last_name || '';
      const name = (firstName + ' ' + lastName).trim() || data.email || 'Anonymous';
      
      return {
        id: sub.id,
        name: name,
        email: data.email || '',
        loc: data.location || data.Location || 'Unknown',
        joined: new Date(sub.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        progress: 0,
        module: 1,
        status: 'new',
        source: data.source || data.how || 'Unknown'
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
      body: JSON.stringify({ error: 'Failed to fetch members: ' + error.message })
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