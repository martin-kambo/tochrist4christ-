// netlify/functions/export-members.js
//
// Returns all members as a downloadable CSV file.
// Called by the admin dashboard "Export CSV" button.
// Protected — requires a valid admin session cookie.

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
}

function verifySession(event) {
  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) return false;
  const cookies = parseCookies(event.headers.cookie);
  const token   = cookies['admin_session'];
  if (!token) return false;
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length) return false;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp && data.exp > Date.now();
  } catch { return false; }
}

// Safely escape a value for CSV
function csvCell(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  // Wrap in quotes if it contains commas, quotes, or newlines
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!verifySession(event)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  try {
    const store       = getStore('members');
    const { blobs }   = await store.list();
    const members     = await Promise.all(
      blobs.map(async ({ key }) => {
        const m = await store.get(key, { type: 'json' });
        return m;
      })
    );

    const valid = members
      .filter(Boolean)
      .sort((a, b) => new Date(a.joinedISO || a.joined) - new Date(b.joinedISO || b.joined));

    // CSV header row
    const headers = ['Name', 'Email', 'Phone', 'Location', 'Source', 'Faith Stage', 'Joined', 'Status', 'Progress (%)'];
    const rows    = valid.map(m => [
      csvCell(m.name),
      csvCell(m.email),
      csvCell(m.phone),
      csvCell(m.loc),
      csvCell(m.source),
      csvCell(m.faithStage),
      csvCell(m.joined),
      csvCell(m.status),
      csvCell(m.progress || 0),
    ].join(','));

    const csv      = [headers.join(','), ...rows].join('\r\n');
    const filename = `tc4c-members-${new Date().toISOString().slice(0, 10)}.csv`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type':        'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body: csv,
    };
  } catch (err) {
    console.error('export-members error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to export members' }),
    };
  }
};