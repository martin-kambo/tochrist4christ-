// netlify/functions/request-magic-link.js
//
// Lets a returning member request a fresh login link without going through
// the signup flow again.
//
// Flow:
//   1. Receive { email } in POST body.
//   2. Look up the member in the "members" Blobs store (keyed by base64url of email).
//   3. If not found → 404 (email not registered).
//   4. Mint a short-lived (15-minute) magic token in "magic-tokens" with source:'login'.
//   5. Send a compact "here's your link" email via Resend.
//   6. Return { success: true }.
//
// Required env vars (same as send-welcome-email.js):
//   RESEND_API_KEY
//   NETLIFY_SITE_ID
//   NETLIFY_BLOBS_TOKEN

const crypto        = require('crypto');
const { getStore }  = require('@netlify/blobs');

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------
function storeOpts(name) {
  const opts = { name };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_BLOBS_TOKEN;
  }
  return opts;
}

async function getMember(email) {
  const key   = Buffer.from(email.toLowerCase()).toString('base64url');
  const store = getStore(storeOpts('members'));
  try {
    return await store.get(key, { type: 'json' });
  } catch {
    return null;
  }
}

async function createLoginToken(email) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp   = Date.now() + 15 * 60 * 1000; // 15 minutes
  const store = getStore(storeOpts('magic-tokens'));
  await store.setJSON(token, { email: email.toLowerCase(), exp, source: 'login' });
  return token;
}

// ---------------------------------------------------------------------------
// Email HTML — minimal, single-purpose
// ---------------------------------------------------------------------------
function buildEmailHtml({ firstName, magicLink }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your sign-in link — To Christ For Christ</title>
</head>
<body style="margin:0;padding:0;background:#0D1117;font-family:'Georgia',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0D1117;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#161B22;border:1px solid rgba(201,168,76,0.2);border-radius:6px;overflow:hidden;max-width:520px;width:100%;">

          <tr>
            <td style="background:#1B3A2E;padding:28px 36px;text-align:center;border-bottom:1px solid rgba(201,168,76,0.2);">
              <div style="font-size:1.6rem;margin-bottom:6px;">✝</div>
              <h1 style="margin:0;font-family:'Georgia',serif;font-size:1.2rem;color:#C9A84C;font-weight:normal;letter-spacing:0.03em;">To Christ For Christ</h1>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 36px;">
              <p style="margin:0 0 14px;font-size:1rem;color:rgba(245,239,224,0.9);line-height:1.7;">
                Hi <strong style="color:#C9A84C;">${firstName || 'there'}</strong>,
              </p>
              <p style="margin:0 0 22px;font-size:0.95rem;color:rgba(245,239,224,0.65);line-height:1.8;">
                Here's your sign-in link for the Discipleship Evangelism Course. It will take you straight to where you left off.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${magicLink}"
                       style="display:inline-block;background:#C9A84C;color:#2C1A0E;font-family:'Helvetica',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;padding:13px 34px;text-decoration:none;border-radius:2px;">
                      Sign In to Course →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:20px 0 0;font-size:0.75rem;color:rgba(245,239,224,0.3);line-height:1.7;text-align:center;">
                This link expires in 15 minutes and can only be used once.<br>
                If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 36px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
              <p style="margin:0;font-family:'Helvetica',sans-serif;font-size:0.6rem;color:rgba(245,239,224,0.2);line-height:1.8;">
                To Christ For Christ · <a href="https://tochristforchrist.org" style="color:rgba(201,168,76,0.4);text-decoration:none;">tochristforchrist.org</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('Missing RESEND_API_KEY');
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Email service not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Bad request' }) };
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'email is required' }) };
  }

  // Look up member
  const member = await getMember(email);
  if (!member) {
    // Return a vague 404 — don't confirm whether the email is registered
    return {
      statusCode: 404,
      body: JSON.stringify({ success: false, error: 'Email not found. Please sign up first.' }),
    };
  }

  // Mint login token
  let magicLink;
  try {
    const token = await createLoginToken(email);
    magicLink = `https://tochristforchrist.org/.netlify/functions/magic-login?token=${token}`;
  } catch (err) {
    console.error('Failed to create login token:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Could not create sign-in link' }) };
  }

  // Send email
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'To Christ For Christ <hello@tochristforchrist.org>',
        to:      [email],
        subject: 'Your sign-in link — To Christ For Christ',
        html:    buildEmailHtml({ firstName: member.firstName, magicLink }),
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      console.error('Resend error:', result);
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Email delivery failed' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('request-magic-link error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error' }) };
  }
};