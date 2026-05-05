// netlify/functions/moderate-prayer.js
//
// REMOVED — This function is dead code.
// submit-prayer.js already performs server-side moderation with a more
// complete blocked-words list. This older, shorter version is redundant
// and was never called by anything in production.
//
// Returning 410 Gone so any accidental call surfaces a clear error
// rather than silently approving prayers through stale logic.

exports.handler = async () => ({
  statusCode: 410,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    error: 'This endpoint has been removed. Moderation is handled inside submit-prayer.',
  }),
});