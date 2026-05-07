// netlify/functions/admin-daily-content.js
import { getStore } from '@netlify/blobs';

// Admin credentials (store these in environment variables in production)
const ADMIN_EMAILS = ['admin@tochristforchrist.org', 'hello@tochristforchrist.org'];

export default async (req, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  // Simple auth check (replace with your actual auth system)
  const authHeader = req.headers.get('authorization');
  let isAdmin = false;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      // Verify token with your existing auth system
      // For now, we'll check against admin emails in the request body
      const body = await req.json().catch(() => ({}));
      isAdmin = ADMIN_EMAILS.includes(body.adminEmail);
    } catch (e) {
      isAdmin = false;
    }
  }

  if (!isAdmin && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { headers, status: 401 });
  }

  const store = getStore('daily-content');

  // GET: List all meditations or get specific one
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const date = url.searchParams.get('date');
    
    if (date) {
      try {
        const meditation = await store.get(date);
        if (!meditation) {
          return new Response(JSON.stringify({ error: 'Not found' }), { headers, status: 404 });
        }
        return new Response(meditation, { headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Not found' }), { headers, status: 404 });
      }
    } else {
      // List all meditations (for admin)
      const keys = [];
      // Note: Netlify Blobs doesn't have native list, so we'd need to maintain an index
      // For MVP, we'll return empty and rely on direct date access
      return new Response(JSON.stringify({ meditations: [], message: 'Use date parameter to get specific meditation' }), { headers });
    }
  }

  // POST: Create or update meditation for a specific date
  if (req.method === 'POST') {
    const { date, title, verse, verseText, reflection, prayerPrompt, actionStep, adminEmail } = await req.json();
    
    if (!date || !title || !verse || !verseText) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { headers, status: 400 });
    }
    
    if (!ADMIN_EMAILS.includes(adminEmail)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { headers, status: 401 });
    }

    const meditation = {
      id: `admin-${date}`,
      date,
      title,
      verse,
      verseText,
      reflection: reflection || '',
      prayerPrompt: prayerPrompt || '',
      actionStep: actionStep || '',
      createdAt: new Date().toISOString(),
      createdBy: adminEmail
    };

    await store.set(date, JSON.stringify(meditation));
    
    return new Response(JSON.stringify({ success: true, meditation }), { headers });
  }

  // DELETE: Remove meditation for a date
  if (req.method === 'DELETE') {
    const { date, adminEmail } = await req.json();
    
    if (!ADMIN_EMAILS.includes(adminEmail)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { headers, status: 401 });
    }
    
    await store.delete(date);
    return new Response(JSON.stringify({ success: true }), { headers });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { headers, status: 405 });
};