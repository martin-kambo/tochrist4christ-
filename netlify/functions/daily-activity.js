// netlify/functions/daily-activity.js
//
// V2 PHASE 1 SECURITY CHANGE — see TC4C_TECHNICAL_FINDINGS.md (C3) and
// TC4C_V2_PHASE1_ARCHITECTURE.md:
//   Previously this endpoint accepted an arbitrary `email` in the POST
//   body as proof of identity, so anyone could log — or overwrite —
//   another person's daily activity and journal text with no
//   authentication at all. It now:
//     - requires a valid member_session cookie (see shared/member-auth.js)
//     - derives the email SOLELY from that verified session
//     - returns 401 if there is no valid session
//     - ignores any `email` field the caller sends in the body
//
//   PRESERVED, INTENTIONALLY, FOR THIS PHASE: the Blobs "daily-engagement"
//   store still keys records by the raw lowercase email string (not the
//   base64url encoding used by the "members"/"magic-tokens" stores — see
//   TC4C_TECHNICAL_FINDINGS.md H7). Changing that key encoding would be a
//   data-migration decision, not an authentication fix, and is out of
//   scope for this phase; it is documented here and in
//   TC4C_V2_PHASE1_ARCHITECTURE.md as a known limitation for a later
//   phase. Existing engagement records, if any, remain readable under
//   their current key.

import { getStore } from '@netlify/blobs';
import { getAuthenticatedMember } from './shared/member-auth.js';

const MAX_JOURNAL_LENGTH = 4000;

export default async (req, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { headers, status: 405 });
  }

  // ── Authenticate: identity comes ONLY from the verified session ───────────
  const cookieHeader = req.headers.get('cookie') || '';
  let member;
  try {
    member = await getAuthenticatedMember({ headers: { cookie: cookieHeader } });
  } catch (err) {
    console.error('daily-activity auth error:', err.message);
    return new Response(JSON.stringify({ error: 'internal error' }), { headers, status: 500 });
  }
  if (!member) {
    return new Response(JSON.stringify({ authenticated: false, error: 'Unauthorized' }), { headers, status: 401 });
  }
  const email = member.email;

  try {
    const { activity, date, content } = await req.json();

    if (!activity) {
      return new Response(JSON.stringify({ error: 'Missing activity' }), { headers, status: 400 });
    }

    const today = date || new Date().toISOString().split('T')[0];

    // Get the store - this creates it if it doesn't exist
    const userStore = getStore('daily-engagement');

    // Get existing user data (returns null if never saved)
    let userData = null;
    try {
      const existing = await userStore.get(email);
      if (existing) {
        userData = JSON.parse(existing);
      }
    } catch (e) {
      // No data yet - that's fine
      console.log(`No existing data for this member, creating new record`);
    }

    // Initialize if this is a new user
    if (!userData) {
      userData = {
        activities: {},
        streak: 0,
        lastActive: null,
        journalEntries: {},
        createdAt: new Date().toISOString()
      };
    }

    // Ensure nested objects exist
    if (!userData.activities) userData.activities = {};
    if (!userData.journalEntries) userData.journalEntries = {};

    // Initialize today's activity if needed
    if (!userData.activities[today]) {
      userData.activities[today] = {
        reflected: false,
        prayed: false,
        journaled: false,
        memorized: false,
        completedAt: null,
        journalContent: null
      };
    }

    // Update the specific activity
    const validActivities = ['reflected', 'prayed', 'journaled', 'memorized'];
    if (validActivities.includes(activity)) {
      userData.activities[today][activity] = true;

      // If journaled, save content (length-bounded — see PART P security checklist)
      if (activity === 'journaled' && content) {
        const cleanContent = String(content).slice(0, MAX_JOURNAL_LENGTH);
        userData.journalEntries[today] = cleanContent;
        userData.activities[today].journalContent = cleanContent;
      }
    } else {
      return new Response(JSON.stringify({ error: 'Invalid activity type' }), { headers, status: 400 });
    }

    // Check if all activities are completed for today
    const allCompleted = userData.activities[today].reflected &&
                         userData.activities[today].prayed &&
                         userData.activities[today].journaled &&
                         userData.activities[today].memorized;

    if (allCompleted && !userData.activities[today].completedAt) {
      userData.activities[today].completedAt = new Date().toISOString();

      // Update streak
      const lastActiveDate = userData.lastActive ? new Date(userData.lastActive) : null;
      const todayDate = new Date(today);
      const yesterday = new Date(todayDate);
      yesterday.setDate(yesterday.getDate() - 1);

      if (lastActiveDate && lastActiveDate.toDateString() === yesterday.toDateString()) {
        userData.streak = (userData.streak || 0) + 1;
      } else if (!lastActiveDate || lastActiveDate.toDateString() !== todayDate.toDateString()) {
        userData.streak = 1;
      } else {
        // Same day, don't change streak
      }

      userData.lastActive = today;
    }

    // Save back to blob store - this creates the blob if it doesn't exist
    await userStore.set(email, JSON.stringify(userData));

    return new Response(JSON.stringify({
      success: true,
      activity,
      allCompleted,
      streak: userData.streak || 0,
      activities: userData.activities[today]
    }), { headers });

  } catch (error) {
    console.error('Daily activity error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to log activity: ' + error.message
    }), { headers, status: 500 });
  }
};
