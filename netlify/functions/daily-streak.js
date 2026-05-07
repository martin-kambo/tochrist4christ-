// netlify/functions/daily-streak.js
import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  try {
    const url = new URL(req.url);
    const email = url.searchParams.get('email');
    
    if (!email) {
      return new Response(JSON.stringify({ error: 'Email required' }), { headers, status: 400 });
    }

    const userStore = getStore('daily-engagement');
    let userData = { streak: 0, lastActive: null, activities: {} };
    
    try {
      const existing = await userStore.get(email);
      if (existing) {
        userData = JSON.parse(existing);
      }
    } catch (e) {
      // No data yet - return default empty state
      console.log(`No streak data for ${email}, returning defaults`);
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