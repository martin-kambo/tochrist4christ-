const crypto = require('crypto');

const SECRET    = process.env.ADMIN_SESSION_SECRET || 'change-this-secret';
const API_TOKEN = process.env.NETLIFY_API_TOKEN;
const SITE_ID   = process.env.NETLIFY_SITE_ID;

function verifyToken(token) {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (Date.now() - payload.iat > 8 * 60 * 60 * 1000) return null;
    return payload;
  } catch { return null; }
}

function getTokenFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const c of cookies) {
    const [name, ...rest] = c.split('=');
    if (name.trim() === 'tc4c_admin') return rest.join('=');
  }
  return null;
}

function formatDate(isoString) {
  if (!isoString) return 'Unknown';
  return new Date(isoString).toLocaleDateString('en-KE', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function inferStatus(submission) {
  const daysSince = (Date.now() - new Date(submission.created_at)) / (1000 * 60 * 60 * 24);
  if (daysSince <= 7) return 'new';
  return 'active';
}

exports.handler = async function (event) {
  // Auth check
  const token = getTokenFromCookie(event.headers.cookie);
  if (!verifyToken(token)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!API_TOKEN || !SITE_ID) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'NETLIFY_API_TOKEN or NETLIFY_SITE_ID not set' })
    };
  }

  try {
    // Fetch all submissions from the "signup" form
    const response = await fetch(
      `https://api.netlify.com/api/v1/sites/${SITE_ID}/submissions?per_page=500`,
      { headers: { Authorization: `Bearer ${API_TOKEN}` } }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error('Netlify API error:', response.status, text);
      return { statusCode: 502, body: JSON.stringify({ error: 'Failed to fetch from Netlify API' }) };
    }

    const submissions = await response.json();

    // Filter to only signup form submissions and map to member objects
    const members = submissions
      .filter(s => s.form_name === 'signup')
      .map(s => {
        const d = s.data || {};
        const firstName = d.firstName || d['first-name'] || '';
        const lastName  = d.lastName  || d['last-name']  || '';
        const name = [firstName, lastName].filter(Boolean).join(' ') || d.name || 'Unknown';
        return {
          id:       s.id,
          name:     name,
          email:    d.email || '',
          loc:      d.location || d.area || '',
          source:   d.source || 'Unknown',
          faith:    d.faithStage || '',
          phone:    d.phone || '',
          joined:   formatDate(s.created_at),
          joinedAt: s.created_at,
          status:   inferStatus(s),
          progress: 0,
          module:   1,
        };
      })
      // Most recent first
      .sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members, total: members.length }),
    };

  } catch (err) {
    console.error('get-members error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};