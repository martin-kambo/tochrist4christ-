// netlify/functions/send-email.js

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  const cookies = parseCookies(event.headers.cookie || '');
  const sessionToken = cookies.admin_session;
  
  if (!sessionToken || sessionToken !== process.env.ADMIN_SESSION_TOKEN) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }
  
  try {
    const { memberEmail, memberName, subject, message } = JSON.parse(event.body);
    
    if (!memberEmail || !subject || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email, subject, and message are required' })
      };
    }
    
    const emailJsPayload = {
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_ADMIN_TEMPLATE,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      template_params: {
        to_name: memberName,
        to_email: memberEmail,
        from_name: 'Martin — To Christ 4 Christ',
        reply_to: 'hello@tochrist4christ.org',
        subject: subject,
        message: message
      }
    };
    
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailJsPayload)
    });
    
    if (response.ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message: 'Email sent successfully' })
      };
    } else {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to send email' })
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error' })
    };
  }
};

function parseCookies(cookieString) {
  const cookies = {};
  if (!cookieString) return cookies;
  
  cookieString.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    cookies[name] = value;
  });
  
  return cookies;
}