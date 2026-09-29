// netlify/functions/daily-streak.js
//
// V2 PHASE 1 SECURITY CHANGE — see TC4C_TECHNICAL_FINDINGS.md (C3) and
// TC4C_V2_PHASE1_ARCHITECTURE.md:
//   Previously this endpoint accepted an arbitrary `?email=` as proof of
//   identity, so anyone could read another member's streak/activity
//   history. It now:
//     - requires a valid member_session cookie (see shared/member-auth.js)
//     - derives the email SOLELY from that verified session
//     - returns 401 if there is no valid session
//     - ignores any `email` query parameter the caller sends
//
//   Storage shape and key encoding are UNCHANGED (see the note in
//   daily-activity.js about the raw-email key being a documented,
//   deferred item rather than something fixed in this phase).

import { getStore } from '@netlify/blobs';
import { getAuthenticatedMember } from './shared/member-auth.js';

export default async (req, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  // ── Authenticate: identity comes ONLY from the verified session ───────────
  const cookieHeader = req.headers.get('cookie') || '';
  let member;
  try {
    member = await getAuthenticatedMember({ headers: { cookie: cookieHeader } });
  } catch (err) {
    console.error('daily-streak auth error:', err.message);
    return new Response(JSON.stringify({ error: 'internal error' }), { headers, status: 500 });
  }
  if (!member) {
    return new Response(JSON.stringify({ authenticated: false, error: 'Unauthorized' }), { headers, status: 401 });
  }
  const email = member.email;

  try {
    const userStore = getStore('daily-engagement');
    let userData = { streak: 0, lastActive: null, activities: {} };

    try {
      const existing = await userStore.get(email);
      if (existing) {
        userData = JSON.parse(existing);
      }
    } catch (e) {
      // No data yet - return default empty state
      console.log(`No streak data yet for this member, returning defaults`);
    }

    // Ensure activities object exists
    if (!userData.activities) userData.activities = {};

    // Calculate current streak (validate against today)
    const today = new Date().toISOString().split('T')[0];
    const todayActivities = userData.activities[today];
    const allCompletedToday = todayActivities?.reflected && todayActivities?.prayed &&
                              todayActivities?.journaled && todayActivities?.memorized;

    let currentStreak = userData.streak || 0;

    // If they haven't completed today, streak might need adjustment
    if (!allCompletedToday && userData.lastActive !== today) {
      // Check if yesterday was completed
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const yesterdayActivities = userData.activities[yesterdayStr];
      const completedYesterday = yesterdayActivities?.reflected && yesterdayActivities?.prayed &&
                                 yesterdayActivities?.journaled && yesterdayActivities?.memorized;

      if (!completedYesterday && userData.lastActive !== yesterdayStr && userData.lastActive) {
        // Streak broken if last active wasn't today or yesterday
        currentStreak = 0;
      }
    }

    // Get last 7 days of activity for display
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayActivities = userData.activities[dateStr];
      const completed = dayActivities?.reflected && dayActivities?.prayed &&
                        dayActivities?.journaled && dayActivities?.memorized;

      last7Days.push({
        date: dateStr,
        completed: completed || false,
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' })
      });
    }

    return new Response(JSON.stringify({
      success: true,
      streak: currentStreak,
      lastActive: userData.lastActive,
      last7Days,
      todayCompleted: allCompletedToday || false,
      todayActivities: todayActivities || {
        reflected: false,
        prayed: false,
        journaled: false,
        memorized: false
      }
    }), { headers });

  } catch (error) {
    console.error('Streak error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to get streak data: ' + error.message
    }), { headers, status: 500 });
  }
};
