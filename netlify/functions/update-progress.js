/**
 * /.netlify/functions/update-progress
 *
 * Called by course.html each time the user marks a lesson complete.
 * Writes (or merges) a progress record in Redis that get-progress reads.
 *
 * ── Request ─────────────────────────────────────────────────────────────────
 * POST {
 *   email          : string,   // required — identifies the member
 *   lessonId       : string,   // e.g. "m1l3"
 *   lessonTitle    : string,   // title of the lesson just completed
 *   nextLessonTitle: string,   // title of the next lesson (pre-computed by course.html)
 *   currentModule  : number,   // 1 | 2 | 3
 * }
 *
 * ── Response (200) ──────────────────────────────────────────────────────────
 * {
 *   ok             : true,
 *   lessonsCompleted: number,
 *   streak          : number,
 *   badgesEarned    : string[],
 *   newBadge        : string | null,  // if a badge was just unlocked
 * }
 *
 * ── Redis key written ────────────────────────────────────────────────────────
 * progress:<email>   JSON blob (no TTL — progress is permanent)
 *
 * ── Streak logic ─────────────────────────────────────────────────────────────
 * - If lastActivityDate is today     → don't increment (already counted today)
 * - If lastActivityDate is yesterday → increment streak by 1
 * - If lastActivityDate is older / absent → reset streak to 1
 */

const { cmd } = require('./redis');

const TOTAL_LESSONS = 48;

const BADGE_THRESHOLDS = {
  foundation: 16,
  word      : 32,
  prayer    : 40,
  identity  : 48,
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method not allowed' });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON body' }); }

  const email           = (body.email         || '').trim().toLowerCase();
  const lessonId        = (body.lessonId        || '').trim();
  const nextLessonTitle = (body.nextLessonTitle  || '').trim();
  const currentModule   = Number(body.currentModule) || 1;
  const faithStage      = (body.faithStage      || '').trim(); // optional; stored if not already present

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply(400, { error: 'email required' });
  }
  if (!lessonId) {
    return reply(400, { error: 'lessonId required' });
  }

  // ── Load existing progress ────────────────────────────────────────────────
  let stored = {};
  try {
    const raw = await cmd('GET', `progress:${email}`);
    if (raw) stored = JSON.parse(raw);
  } catch (err) {
    console.error('[update-progress] Redis read error:', err);
    return reply(500, { error: 'internal error' });
  }

  // ── De-duplicate: skip if lesson already recorded ─────────────────────────
  const completedSet = new Set(Array.isArray(stored.completedIds) ? stored.completedIds : []);
  const isNew = !completedSet.has(lessonId);

  if (isNew) completedSet.add(lessonId);
  const lessonsCompleted = Math.min(completedSet.size, TOTAL_LESSONS);

  // ── Streak computation ────────────────────────────────────────────────────
  const todayStr = utcDateString(new Date());
  let streak     = Number(stored.streak) || 0;

  if (isNew) {
    const lastDate = stored.lastActivityDate || null;
    if (!lastDate) {
      streak = 1; // first ever lesson
    } else if (lastDate === todayStr) {
      // already active today — streak unchanged
    } else {
      const diffDays = daysDiff(lastDate, todayStr);
      if (diffDays === 1) {
        streak += 1; // consecutive day
      } else {
        streak = 1;  // gap → reset
      }
    }
  }

  // ── Badge unlock check ───────────────────────────────────────────────────
  const earnedBefore = new Set(Array.isArray(stored.badgesEarned) ? stored.badgesEarned : []);
  const earnedAfter  = new Set(earnedBefore);
  let newBadge = null;

  for (const [id, threshold] of Object.entries(BADGE_THRESHOLDS)) {
    if (lessonsCompleted >= threshold && !earnedBefore.has(id)) {
      earnedAfter.add(id);
      newBadge = id; // report the most-recently unlocked badge to the client
    }
  }

  // ── Build updated record ──────────────────────────────────────────────────
  const updated = {
    ...stored,
    completedIds    : [...completedSet],
    lessonsCompleted,
    streak,
    lastActivityDate: isNew ? todayStr : (stored.lastActivityDate || todayStr),
    currentModule,
    nextLessonTitle : nextLessonTitle || stored.nextLessonTitle || '',
    badgesEarned    : [...earnedAfter],
    // faithStage is written on first update and never overwritten —
    // course.html should pass it so get-progress can use it as a fallback
    // even if the member:<email> record is unavailable.
    faithStage      : stored.faithStage || faithStage || '',
    updatedAt       : new Date().toISOString(),
  };

  // ── Persist ───────────────────────────────────────────────────────────────
  // No TTL — progress records are permanent.
  try {
    await cmd('SET', `progress:${email}`, JSON.stringify(updated));
  } catch (err) {
    console.error('[update-progress] Redis write error:', err);
    return reply(500, { error: 'internal error' });
  }

  console.log(`[update-progress] ${email} — lesson ${lessonId} | streak ${streak} | total ${lessonsCompleted}`);

  return reply(200, {
    ok              : true,
    lessonsCompleted,
    streak,
    badgesEarned    : [...earnedAfter],
    newBadge,         // null if nothing newly unlocked
  });
};

// ── Date helpers ─────────────────────────────────────────────────────────────

/** Returns "YYYY-MM-DD" in UTC for the given Date. */
function utcDateString(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the number of calendar days between two "YYYY-MM-DD" strings.
 * Always positive (or zero).
 */
function daysDiff(a, b) {
  const msA = Date.UTC(...a.split('-').map(Number));
  const msB = Date.UTC(...b.split('-').map(Number));
  return Math.abs(Math.round((msB - msA) / 86_400_000));
}

// ── Response helper ───────────────────────────────────────────────────────────
function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body),
  };
}