const crypto = require('crypto');

const SECRET        = process.env.ADMIN_SESSION_SECRET || 'change-this-secret';
const API_TOKEN     = process.env.NETLIFY_API_TOKEN;
const SITE_ID       = process.env.NETLIFY_SITE_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

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

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const token = getTokenFromCookie(event.headers.cookie);
  if (!verifyToken(token)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { memberId, subject, message } = body;
  if (!memberId || !subject || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'memberId, subject, and message are required' }) };
  }

  // Look up the member's email from Netlify submissions
  try {
    const subResponse = await fetch(
      `https://api.netlify.com/api/v1/submissions/${memberId}`,
      { headers: { Authorization: `Bearer ${API_TOKEN}` } }
    );

    if (!subResponse.ok) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Member not found' }) };
    }

    const submission = await subResponse.json();
    const d = submission.data || {};
    const toEmail = d.email;
    const firstName = d.firstName || d.name || 'Friend';

    if (!toEmail) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Member has no email address' }) };
    }

    // Send via Resend
    const htmlMessage = message.replace(/\n/g, '<br>');

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Martin — To Christ 4 Christ <tochristforchrist.org>',
        to: [toEmail],
        subject: subject,
        text: message,
        html: `
          <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:40px 20px;">
            <p style="font-size:13px;letter-spacing:2px;color:#C9A84C;text-transform:uppercase;margin-bottom:24px;">To Christ 4 Christ</p>
            <div style="font-size:16px;color:#3C2A1A;line-height:1.8;">${htmlMessage}</div>
            <hr style="border:none;border-top:1px solid #EDE5CC;margin:32px 0;">
            <p style="font-size:12px;color:#7A6A50;">— Martin, To Christ 4 Christ</p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.json();
      console.error('Resend error:', err);
      return { statusCode: 502, body: JSON.stringify({ error: 'Failed to send email via Resend' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };

  } catch (err) {
    console.error('send-email error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};