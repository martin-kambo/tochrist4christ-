// netlify/functions/send-email.js

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  try {
    const { memberEmail, memberName, subject, message } = JSON.parse(event.body);
    
    if (!memberEmail || !subject || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email, subject, and message are required' })
      };
    }
    
    // EmailJS configuration from environment variables
    const emailJsPayload = {
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_ADMIN_TEMPLATE,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      template_params: {
        to_name: memberName,
        to_email: memberEmail,
        from_name: 'To Christ 4 Christ',
        reply_to: 'hello@tochrist4christ.org',
        subject: subject,
        message: message
      }
    };
    
    console.log('Sending email to:', memberEmail);
    
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailJsPayload)
    });
    
    const responseText = await response.text();
    console.log('EmailJS response:', response.status, responseText);
    
    if (response.ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message: 'Email sent successfully' })
      };
    } else {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'EmailJS error: ' + responseText })
      };
    }
  } catch (error) {
    console.error('Email error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error: ' + error.message })
    };
  }
};