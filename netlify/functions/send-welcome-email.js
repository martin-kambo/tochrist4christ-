// netlify/functions/send-welcome-email.js
//
// Sends a welcome email to a new member via Resend (resend.com).
// Called by index.html handleSubmit after a successful signup.
//
// Required Netlify environment variables:
//   RESEND_API_KEY  — get from resend.com → API Keys
//
// Required Resend setup:
//   1. Go to resend.com → Domains → Add Domain → tochristforchrist.org
//   2. Add the DNS records Resend gives you in Host Pinnacle
//   3. Wait for verification (usually 5–10 min)
//   Then emails will send from hello@tochristforchrist.org

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('Missing RESEND_API_KEY environment variable');
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Email service not configured' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Bad request' }) };
  }

  const { to_email, firstName, lastName } = body;

  if (!to_email || !firstName) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'to_email and firstName are required' }),
    };
  }

  const fullName = `${firstName} ${lastName || ''}`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to To Christ 4 Christ</title>
</head>
<body style="margin:0;padding:0;background:#0D1117;font-family:'Georgia',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0D1117;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#161B22;border:1px solid rgba(201,168,76,0.2);border-radius:6px;overflow:hidden;max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#1B3A2E;padding:36px 40px;text-align:center;border-bottom:1px solid rgba(201,168,76,0.2);">
              <div style="font-size:2rem;margin-bottom:8px;">✝</div>
              <h1 style="margin:0;font-family:'Georgia',serif;font-size:1.5rem;color:#C9A84C;font-weight:normal;letter-spacing:0.03em;">To Christ 4 Christ</h1>
              <p style="margin:6px 0 0;font-family:'Helvetica',sans-serif;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:rgba(245,239,224,0.4);">A Discipleship Journey</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 16px;font-size:1.1rem;color:rgba(245,239,224,0.9);line-height:1.7;">
                Dear <strong style="color:#C9A84C;">${fullName}</strong>,
              </p>
              <p style="margin:0 0 16px;font-size:1rem;color:rgba(245,239,224,0.7);line-height:1.8;">
                Welcome. We are genuinely glad you are here.
              </p>
              <p style="margin:0 0 16px;font-size:1rem;color:rgba(245,239,224,0.7);line-height:1.8;">
                You have taken your first step into a structured discipleship journey — six modules built to take you from the foundations of faith all the way to living on mission. Everything is free. Everything is yours. Work at your own pace.
              </p>

              <!-- Verse block -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td style="border-left:3px solid #C9A84C;padding:12px 20px;background:rgba(201,168,76,0.05);">
                    <p style="margin:0;font-style:italic;font-size:1rem;color:rgba(245,239,224,0.8);line-height:1.7;">
                      "Like a tree planted by streams of water, which yields its fruit in season and whose leaf does not wither — whatever they do prospers."
                    </p>
                    <p style="margin:8px 0 0;font-family:'Helvetica',sans-serif;font-size:0.72rem;letter-spacing:0.12em;color:#C9A84C;">— Psalm 1:3</p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;font-size:1rem;color:rgba(245,239,224,0.7);line-height:1.8;">
                Your journey begins with <strong style="color:rgba(245,239,224,0.9);">Module 1: The Foundation — Who Is God?</strong> Head back to the site, open the course, and click your first lesson.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
                <tr>
                  <td align="center">
                    <a href="https://tochristforchrist.org/#course"
                       style="display:inline-block;background:#C9A84C;color:#2C1A0E;font-family:'Helvetica',sans-serif;font-size:0.78rem;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;padding:14px 36px;text-decoration:none;border-radius:2px;">
                      Begin Module 1 →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:1rem;color:rgba(245,239,224,0.7);line-height:1.8;">
                We are walking this journey with you. Reply to this email anytime — we read every message.
              </p>
              <p style="margin:0;font-size:1rem;color:rgba(245,239,224,0.7);line-height:1.8;">
                In His grace,<br>
                <strong style="color:rgba(245,239,224,0.9);">The To Christ 4 Christ Team</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
              <p style="margin:0;font-family:'Helvetica',sans-serif;font-size:0.65rem;color:rgba(245,239,224,0.25);line-height:1.8;">
                To Christ 4 Christ · <a href="https://tochristforchrist.org" style="color:rgba(201,168,76,0.5);text-decoration:none;">tochristforchrist.org</a><br>
                You're receiving this because you signed up for the discipleship course.<br>
                <a href="https://tochristforchrist.org/privacy-policy.html" style="color:rgba(201,168,76,0.5);text-decoration:none;">Privacy Policy</a>
                &nbsp;·&nbsp;
                Governed by the Kenya Data Protection Act, 2019.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'To Christ 4 Christ <hello@tochristforchrist.org>',
        to:      [to_email],
        subject: `Welcome, ${firstName} — Your discipleship journey begins today ✝`,
        html,
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
    console.error('send-welcome-email error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Internal server error' }),
    };
  }
};