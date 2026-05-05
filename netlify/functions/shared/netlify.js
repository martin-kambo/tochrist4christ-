// netlify/functions/shared/netlify.js

async function getNetlifySubmissions(token, siteId) {
  const formsRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!formsRes.ok) {
    throw new Error(`Failed to fetch forms: ${formsRes.status}`);
  }
  
  const forms = await formsRes.json();
  const signupForm = forms.find(f => f.name === 'signup');
  
  if (!signupForm) {
    return [];
  }
  
  const subsRes = await fetch(`https://api.netlify.com/api/v1/forms/${signupForm.id}/submissions?per_page=100`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!subsRes.ok) {
    throw new Error(`Failed to fetch submissions: ${subsRes.status}`);
  }
  
  return await subsRes.json();
}

async function deleteNetlifySubmission(token, submissionId) {
  const res = await fetch(`https://api.netlify.com/api/v1/submissions/${submissionId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  return res.ok;
}

module.exports = { getNetlifySubmissions, deleteNetlifySubmission };

// This file is a shared utility, not a callable Netlify function.
// The handler below prevents Netlify from crashing when it attempts
// to deploy every .js in the functions folder as an invokable endpoint.
exports.handler = async () => ({
  statusCode: 404,
  body: JSON.stringify({ error: 'Not a callable endpoint.' }),
});