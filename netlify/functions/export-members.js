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

function csvEscape(val) {
  if (val == null) return '';
  const str = String(val).replace(/"/g, '""');
  return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
}

exports.handler = async function (event) {
  const token = getTokenFromCookie(event.headers.cookie);
  if (!verifyToken(token)) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  try {
    const response = await fetch(
      `https://api.netlify.com/api/v1/sites/${SITE_ID}/submissions?per_page=500`,
      { headers: { Authorization: `Bearer ${API_TOKEN}` } }
    );

    const submissions = await response.json();
    const signups = submissions.filter(s => s.form_name === 'signup');

    const headers = ['First Name','Last Name','Email','Phone','Location','Faith Stage','Source','Joined'];
    const rows = signups.map(s => {
      const d = s.data || {};
      return [
        d.firstName || '',
        d.lastName  || '',
        d.email     || '',
        d.phone     || '',
        d.location  || '',
        d.faithStage || '',
        d.source    || '',
        new Date(s.created_at).toLocaleDateString('en-KE'),
      ].map(csvEscape).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\r\n');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="tc4c-members-${new Date().toISOString().split('T')[0]}.csv"`,
      },
      body: csv,
    };
  } catch (err) {
    console.error('export-members error:', err);
    return { statusCode: 500, body: 'Export failed' };
  }
};