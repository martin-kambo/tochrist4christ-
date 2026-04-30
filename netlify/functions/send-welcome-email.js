// netlify/functions/send-welcome-email.js
// Place this file at: netlify/functions/send-welcome-email.js

exports.handler = async (event) => {
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

  const { to_email, to_name, firstName, lastName } = body;

  if (!to_email || !to_name) {
    return { statusCode: 400, body: 'Missing required fields: to_email, to_name' };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY environment variable is not set');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  const emailHtml = `
    <div style="font-family: Georgia, serif; max-width: 580px; margin: 0 auto; color: #3C2A1A;">
      <div style="background: #1B3A2E; padding: 32px; text-align: center;">
        <h1 style="font-family: Georgia, serif; color: #C9A84C; font-size: 22px; margin: 0;">
          To Christ 4 Christ
        </h1>
        <p style="color: rgba(245,239,224,0.7); font-style: italic; font-size: 14px; margin: 8px 0 0;">
          A Discipleship Journey
        </p>
      </div>

      <div style="padding: 40px 32px; background: #FFFDF5;">
        <p style="font-size: 18px; margin-bottom: 16px;">
          Dear ${firstName}${lastName ? ' ' + lastName : ''},
        </p>
        <p style="font-size: 17px; line-height: 1.7; margin-bottom: 16px;">
          Welcome to <strong>To Christ 4 Christ</strong>. We are so glad you've taken this step in your discipleship journey.
        </p>
        <p style="font-size: 17px; line-height: 1.7; margin-bottom: 16px; font-style: italic; color: #5a4a30;">
          "Your word is a lamp to my feet and a light to my path." — Psalm 119:105
        </p>
        <p style="font-size: 17px; line-height: 1.7; margin-bottom: 24px;">
          Over the coming weeks, you'll be guided through 6 modules and 28 lessons designed to deepen your walk with Christ. You can return to the site any time to track your progress.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="https://tochrist4christ.netlify.app"
             style="background: #C9A84C; color: #2C1A0E; text-decoration: none;
                    font-family: sans-serif; font-size: 13px; font-weight: 600;
                    letter-spacing: 0.1em; text-transform: uppercase;
                    padding: 14px 32px; border-radius: 2px; display: inline-block;">
            Begin My Journey →
          </a>
        </div>
        <p style="font-size: 15px; color: #7A6A50; line-height: 1.7;">
          In His grace,<br>
          <strong>The To Christ 4 Christ Team</strong>
        </p>
      </div>

      <div style="background: #1B3A2E; padding: 20px 32px; text-align: center;">
        <p style="color: rgba(245,239,224,0.4); font-size: 11px; margin: 0;">
          You received this because you signed up at tochrist4christ.netlify.app<br>
          <a href="https://tochrist4christ.netlify.app/privacy-policy.html"
             style="color: #C9A84C;">Privacy Policy</a>
        </p>
      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'To Christ 4 Christ <onboarding@resend.dev>', // ← change this
        to: [to_email],
        subject: `Welcome, ${firstName} — Your Discipleship Journey Begins`,
        html: emailHtml,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Resend API error:', result);
      return { statusCode: 500, body: JSON.stringify({ error: result }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, id: result.id }),
    };

  } catch (err) {
    console.error('Unexpected error sending email:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};