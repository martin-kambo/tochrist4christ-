// netlify/functions/send-daily-reminders.js
import { getStore } from '@netlify/blobs';

// This tells Netlify to run this function automatically every day at 8 AM UTC
export const config = {
  schedule: "0 8 * * *",
};

export default async (req, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };
  
  // Check if this is a scheduled run or manual request
  const isScheduled = req.headers.get('x-netlify-event') === 'schedule';
  
  try {
    const userStore = getStore('daily-engagement');
    const contentStore = getStore('daily-content');
    
    const today = new Date().toISOString().split('T')[0];
    
    // Get today's meditation
    let meditation = null;
    try {
      meditation = await contentStore.get(today);
      if (meditation) meditation = JSON.parse(meditation);
    } catch (e) {
      // Use fallback
      const dayOfWeek = new Date().getDay();
      const fallbacks = [
        { title: 'The Lord is My Shepherd', verse: 'Psalm 23:1' },
        { title: 'Be Still and Know', verse: 'Psalm 46:10' },
        { title: 'Abide in Me', verse: 'John 15:4' },
        { title: 'Do Not Be Anxious', verse: 'Philippians 4:6' },
        { title: 'Love One Another', verse: 'John 13:34' },
        { title: 'Walk by the Spirit', verse: 'Galatians 5:16' },
        { title: 'Rejoice Always', verse: '1 Thessalonians 5:16' }
      ];
      meditation = fallbacks[dayOfWeek % fallbacks.length];
    }
    
    console.log(`[${new Date().toISOString()}] Daily reminder cron job running`);
    console.log(`Today's meditation: ${meditation?.title || 'Unknown'}`);
    
    // In production, you would:
    // 1. Query all users who haven't completed today's habits
    // 2. Send them an email or push notification
    // 3. Log results
    
    // For now, just log that it ran
    return new Response(JSON.stringify({
      success: true,
      message: isScheduled ? 'Scheduled reminder processed' : 'Manual trigger',
      timestamp: new Date().toISOString(),
      meditation: meditation?.title
    }), { headers });
    
  } catch (error) {
    console.error('Reminder error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), { headers, status: 500 });
  }
};