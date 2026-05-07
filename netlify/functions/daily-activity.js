// netlify/functions/daily-activity.js
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

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { headers, status: 405 });
  }

  try {
    const { email, activity, date, content } = await req.json();

    if (!email || !activity) {
      return new Response(JSON.stringify({ error: 'Missing email or activity' }), { headers, status: 400 });
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
      console.log(`No existing data for ${email}, creating new record`);
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
      
      // If journaled, save content
      if (activity === 'journaled' && content) {
        userData.journalEntries[today] = content;
        userData.activities[today].journalContent = content;
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