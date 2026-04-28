// netlify/functions/moderate-prayer.js

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  try {
    const { name, text, category, anonymous } = JSON.parse(event.body);
    
    const blockedWords = ['spam', 'scam', 'casino', 'viagra', 'porn', 'xxx', 'hack', 'crack'];
    const lowerText = text.toLowerCase();
    
    for (const word of blockedWords) {
      if (lowerText.includes(word)) {
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            approved: false, 
            reason: 'Your prayer contains inappropriate content.' 
          })
        };
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ approved: true, reason: null })
    };
  } catch (error) {
    return {
      statusCode: 200,
      body: JSON.stringify({ approved: true, reason: null })
    };
  }
};