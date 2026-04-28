// netlify/functions/send-welcome-email.js

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  try {
    const { to_email, to_name, firstName, lastName } = JSON.parse(event.body);
    
    const emailJsPayload = {
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_WELCOME_TEMPLATE,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      template_params: {
        to_name: to_name,
        to_email: to_email,
        from_name: 'To Christ 4 Christ',
        reply_to: 'hello@tochrist4christ.org',
        subject: `Welcome to To Christ 4 Christ, ${firstName} ✝`,
        message: `Hi ${firstName},\n\nWe are so glad you've taken this step. Your discipleship journey begins now.\n\nHead back to the site and start ticking off lessons — your progress saves automatically.\n\nBest regards\nMartin — To Christ 4 Christ`
      }
    };
    
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailJsPayload)
    });
    
    return {
      statusCode: response.ok ? 200 : 500,
      body: JSON.stringify({ success: response.ok })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to send welcome email' })
    };
  }
};