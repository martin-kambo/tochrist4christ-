// netlify/functions/daily-content.js
import { getStore } from '@netlify/blobs';

// Fallback meditations (used if no admin content exists)
const FALLBACK_MEDITATIONS = [
  {
    id: 'med-1',
    date: null, // null means rotating
    dayOfWeek: 0, // Sunday
    title: 'The Lord is My Shepherd',
    verse: 'Psalm 23:1',
    verseText: 'The Lord is my shepherd; I shall not want.',
    reflection: 'David wrote this psalm as a reminder that God provides everything we need. Where do you need to trust God\'s provision today?',
    prayerPrompt: 'Thank God for being your shepherd. Ask Him to guide you through today\'s decisions.',
    actionStep: 'Identify one area where you\'ve been self-sufficient. Surrender it to God in prayer.'
  },
  {
    id: 'med-2',
    date: null,
    dayOfWeek: 1, // Monday
    title: 'Be Still and Know',
    verse: 'Psalm 46:10',
    verseText: 'Be still, and know that I am God; I will be exalted among the nations, I will be exalted in the earth.',
    reflection: 'In our noisy world, stillness feels risky. But God invites us to pause and remember who He is.',
    prayerPrompt: 'Sit in silence for 2 minutes. Ask God to calm your racing thoughts.',
    actionStep: 'Turn off notifications for one hour today. Use that time for unhurried prayer.'
  },
  {
    id: 'med-3',
    date: null,
    dayOfWeek: 2,
    title: 'Abide in Me',
    verse: 'John 15:4',
    verseText: 'Abide in me, and I in you. As the branch cannot bear fruit by itself, unless it abides in the vine, neither can you, unless you abide in me.',
    reflection: 'Jesus isn\'t asking for occasional visits. He invites us to live in constant connection with Him.',
    prayerPrompt: 'Ask God to reveal anything blocking your connection with Him today.',
    actionStep: 'Set a recurring hourly reminder: "Am I abiding right now?"'
  },
  {
    id: 'med-4',
    date: null,
    dayOfWeek: 3,
    title: 'Do Not Be Anxious',
    verse: 'Philippians 4:6-7',
    verseText: 'Do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God.',
    reflection: 'Anxiety shrinks our vision. Prayer expands it to include God\'s presence and power.',
    prayerPrompt: 'Write down three things causing you anxiety. Pray specifically over each one.',
    actionStep: 'Practice the "pause and pray" method — every time you feel anxious, stop and pray immediately.'
  },
  {
    id: 'med-5',
    date: null,
    dayOfWeek: 4,
    title: 'Love One Another',
    verse: 'John 13:34-35',
    verseText: 'A new commandment I give to you, that you love one another: just as I have loved you, you also are to love one another.',
    reflection: 'Jesus\' love was sacrificial, practical, and persistent. That\'s our model.',
    prayerPrompt: 'Ask God to show you one person who needs tangible love today.',
    actionStep: 'Do one unexpected act of kindness for someone today (text, call, favor).'
  },
  {
    id: 'med-6',
    date: null,
    dayOfWeek: 5,
    title: 'Walk by the Spirit',
    verse: 'Galatians 5:16',
    verseText: 'But I say, walk by the Spirit, and you will not gratify the desires of the flesh.',
    reflection: 'Walking implies direction, pace, and companionship with the Spirit.',
    prayerPrompt: 'Invite the Holy Spirit to guide your words, thoughts, and actions today.',
    actionStep: 'Before every decision today (even small ones), pause and ask: "What does the Spirit say?"'
  },
  {
    id: 'med-7',
    date: null,
    dayOfWeek: 6,
    title: 'Rejoice Always',
    verse: '1 Thessalonians 5:16-18',
    verseText: 'Rejoice always, pray without ceasing, give thanks in all circumstances; for this is the will of God in Christ Jesus for you.',
    reflection: 'Joy isn\'t dependent on circumstances. It\'s rooted in God\'s unchanging character.',
    prayerPrompt: 'Name five things you\'re grateful for today — include hard things too.',
    actionStep: 'Share one thing you\'re rejoicing about in your community group today.'
  },
  {
    id: 'med-8',
    date: null,
    dayOfWeek: 6, // Saturday (special weekend reflection)
    title: 'Rest in God',
    verse: 'Matthew 11:28-30',
    verseText: 'Come to me, all who labor and are heavy laden, and I will give you rest.',
    reflection: 'Sabbath rest isn\'t laziness. It\'s trust that God holds everything together.',
    prayerPrompt: 'What\'s been exhausting you? Lay it down before Jesus.',
    actionStep: 'Plan a real Sabbath break today — at least 2 hours with no work, no screens, just rest.'
  }
];

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
    const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
    const userEmail = url.searchParams.get('email');

    // Get store
    const store = getStore('daily-content');
    
    // Try to get admin-configured meditation for this date
    let meditation = null;
    try {
      meditation = await store.get(date);
      if (meditation) {
        meditation = JSON.parse(meditation);
      }
    } catch (e) {
      // No admin content for this date
    }

    // Fallback to rotating meditation if no admin content
    if (!meditation) {
      const dayOfWeek = new Date(date).getDay();
      meditation = FALLBACK_MEDITATIONS.find(m => m.dayOfWeek === dayOfWeek) || FALLBACK_MEDITATIONS[0];
      meditation.id = `fallback-${date}`;
      meditation.date = date;
    }

    // If user is logged in, get their engagement data for today
    let engagement = null;
    if (userEmail) {
      const userStore = getStore('daily-engagement');
      try {
        const userData = await userStore.get(userEmail);
        if (userData) {
          const parsed = JSON.parse(userData);
          engagement = parsed.activities?.[date] || null;
        }
      } catch (e) {
        // No engagement yet
      }
    }

    return new Response(JSON.stringify({
      success: true,
      meditation,
      engagement: engagement || {
        reflected: false,
        prayed: false,
        journaled: false,
        memorized: false,
        completedAt: null
      },
      date
    }), { headers });
  } catch (error) {
    console.error('Daily content error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to load daily content'
    }), { headers, status: 500 });
  }
};