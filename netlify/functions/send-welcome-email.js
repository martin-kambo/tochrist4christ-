exports.handler = async function (event) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { to_email, to_name, firstName } = body;
  const name = firstName || to_name || 'Friend';

  if (!to_email) {
    return { statusCode: 400, body: 'Missing email address' };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY environment variable is not set');
    return { statusCode: 500, body: 'Email service not configured' };
  }

  const emailBody = `Hi ${name},

Welcome to TC4C! We are excited to walk this journey with you.

Kindly refresh the site to start on the course module.

God bless you as you intend to walk in the knowledge of Him and Christ whom He sent.

Best Regards,
Martin — To Christ 4 Christ`;

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F5EFE0;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE0;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#FFFDF5;border-radius:4px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:#1B3A2E;padding:32px 40px;text-align:center;">
              <p style="margin:0 0 6px;font-family:Georgia,serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#C9A84C;">A Discipleship Journey</p>
              <h1 style="margin:0;font-family:Georgia,serif;font-size:26px;color:#F5EFE0;font-weight:normal;line-height:1.3;">To Christ 4 Christ</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 20px;font-size:20px;color:#1B3A2E;font-family:Georgia,serif;">Hi ${name},</p>
              <p style="margin:0 0 16px;font-size:16px;color:#3C2A1A;line-height:1.7;">
                Welcome to TC4C! We are excited to walk this journey with you.
              </p>
              <p style="margin:0 0 28px;font-size:16px;color:#3C2A1A;line-height:1.7;">
                Kindly refresh the site to start on the course module.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                <tr>
                  <td style="background:#C9A84C;border-radius:2px;">
                    <a href="https://tochrist4christ.org" style="display:inline-block;padding:13px 32px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#2C1A0E;text-decoration:none;">
                      Go to My Course &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider + verse -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="border-top:1px solid #EDE5CC;padding-top:24px;">
                    <p style="margin:0;font-family:Georgia,serif;font-style:italic;font-size:14px;color:#7A6A50;line-height:1.7;padding-left:12px;border-left:2px solid #C9A84C;">
                      "Like a tree planted by streams of water, which yields its fruit in season and whose leaf does not wither — whatever they do prospers."<br>
                      <span style="font-style:normal;font-size:12px;letter-spacing:1px;color:#C9A84C;">— Psalm 1:3</span>
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 6px;font-size:15px;color:#3C2A1A;line-height:1.7;">
                God bless you as you intend to walk in the knowledge of Him and Christ whom He sent.
              </p>
            </td>
          </tr>

          <!-- Signature -->
          <tr>
            <td style="padding:0 40px 40px;">
              <p style="margin:0;font-size:15px;color:#3C2A1A;line-height:1.8;">
                Best Regards,<br>
                <strong style="color:#1B3A2E;">Martin</strong><br>
                <span style="font-size:13px;color:#7A6A50;letter-spacing:1px;">To Christ 4 Christ</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#1B3A2E;padding:20px 40px;text-align:center;">
              <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:rgba(245,239,224,0.4);letter-spacing:1px;">
                © 2026 To Christ 4 Christ &middot; Built with faith, intention, and love.<br>
                <a href="https://tochrist4christ.org/privacy-policy.html" style="color:rgba(201,168,76,0.6);text-decoration:none;">Privacy Policy</a>
                &nbsp;&middot;&nbsp;
                You're receiving this because you signed up at tochrist4christ.org
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Martin — To Christ 4 Christ <onboarding@resend.dev>',
        to: [to_email],
        subject: `Welcome to TC4C, ${name} 🌿`,
        text: emailBody,
        html: htmlBody,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Resend API error:', result);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: result }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, id: result.id }),
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};