// netlify/functions/send-email.js
//
// Sends an encouragement email from the admin to a specific member.
// Called by the admin dashboard "Send Message" button.
// Protected — requires a valid admin session cookie.
//
// Required environment variable: RESEND_API_KEY

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!verifySession(event)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ success: false, error: 'Unauthorized' }),
    };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Email service not configured — add RESEND_API_KEY to Netlify environment variables' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Bad request' }) }; }

  const { memberId, subject, message } = body;
  if (!memberId || !subject || !message) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'memberId, subject, and message are required' }),
    };
  }

  // Look up member from Blobs
  let member;
  try {
    const store = getStore('members');
    member = await store.get(memberId, { type: 'json' });
  } catch (err) {
    console.error('Failed to fetch member for email:', err);
    return {
      statusCode: 404,
      body: JSON.stringify({ success: false, error: 'Member not found' }),
    };
  }

  if (!member || !member.email) {
    return {
      statusCode: 404,
      body: JSON.stringify({ success: false, error: 'Member has no email address on record' }),
    };
  }

  // Convert plain text message to HTML (preserve line breaks)
  const messageHtml = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0D1117;font-family:'Georgia',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0D1117;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#161B22;border:1px solid rgba(201,168,76,0.2);border-radius:6px;overflow:hidden;max-width:560px;width:100%;">
          <tr>
            <td style="background:#1B3A2E;padding:28px 40px;text-align:center;border-bottom:1px solid rgba(201,168,76,0.2);">
              <h1 style="margin:0;font-family:'Georgia',serif;font-size:1.3rem;color:#C9A84C;font-weight:normal;">To Christ 4 Christ</h1>
              <p style="margin:4px 0 0;font-family:'Helvetica',sans-serif;font-size:0.6rem;letter-spacing:0.2em;text-transform:uppercase;color:rgba(245,239,224,0.4);">A message from the team</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 20px;font-size:1rem;color:rgba(245,239,224,0.75);line-height:1.8;">${messageHtml}</p>
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:24px 0;">
              <p style="margin:0;font-family:'Helvetica',sans-serif;font-size:0.65rem;color:rgba(245,239,224,0.25);line-height:1.8;text-align:center;">
                To Christ 4 Christ · <a href="https://tochristforchrist.org" style="color:rgba(201,168,76,0.5);text-decoration:none;">tochristforchrist.org</a><br>
                <a href="https://tochristforchrist.org/privacy-policy.html" style="color:rgba(201,168,76,0.5);text-decoration:none;">Privacy Policy</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'To Christ 4 Christ <hello@tochristforchrist.org>',
        to:      [member.email],
        subject: subject,
        html,
        reply_to: 'hello@tochristforchrist.org',
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      console.error('Resend error:', result);
      return {
        statusCode: 500,
        body: JSON.stringify({ success: false, error: result.message || 'Email delivery failed' }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, id: result.id }),
    };
  } catch (err) {
    console.error('send-email error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Internal server error' }),
    };
  }
};