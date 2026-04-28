// netlify/functions/admin-login.js

const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  try {
    const { password } = JSON.parse(event.body);
    const storedHash = process.env.ADMIN_PASSWORD_HASH;
    
    if (!storedHash) {
      return {
        statusCode: 500,
        body: JSON.stringify({ success: false, error: 'Server configuration error' })
      };
    }
    
    const inputHash = crypto.createHash('sha256').update(password).digest('hex');
    const isValid = inputHash === storedHash;
    
    if (!isValid) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Invalid password' })
      };
    }
    
    const sessionToken = crypto.randomBytes(32).toString('hex');
    
    return {
      statusCode: 200,
      headers: {
        'Set-Cookie': `admin_session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ success: true, user: { name: 'Admin' } })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Server error' })
    };
  }
};