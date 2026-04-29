exports.handler = async function () {
  return {
    statusCode: 200,
    headers: {
      'Set-Cookie': 'tc4c_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ success: true }),
  };
};