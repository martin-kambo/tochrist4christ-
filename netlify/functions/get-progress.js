/**
 * /.netlify/functions/get-progress
 *
 * Returns a member's full course-progress snapshot including which modules
 * are currently accessible based on their faith stage and lesson history.
 *
 * ── Request ──────────────────────────────────────────────────────────────────
 * POST  { email: string }
 *
 * ── Response (200) ───────────────────────────────────────────────────────────
 * {
 *   lessonsCompleted : number,   // 0–48
 *   streak           : number,   // current consecutive-day streak
 *   currentModule    : number,   // 1 | 2 | 3
 *   nextLessonTitle  : string,
 *   badgesEarned     : string[], // e.g. ['foundation', 'word']
 *   moduleAccess     : number,   // highest module number the member may enter
 *   faithStage       : string,   // echoed back so the client can re-derive access
 * }
 *
 * ── Module access model ───────────────────────────────────────────────────────
 *
 *   Faith-stage initial grant (day-1 access regardless of lesson count):
 *     just_starting → 1   New to faith; begin at Foundation
 *     feeling_stuck → 2   Knows the basics; Foundation + The Word unlocked
 *     returning     → 1   Returning believer; restart from Foundation
 *     growing       → 3   Seasoned; all three modules open immediately
 *
 *   Progress-based unlock (earned by completing lessons):
 *     0–15  completed → 1
 *     16–31 completed → 2
 *     32+   completed → 3
 *
 *   Effective access = max(faith-stage grant, progress-based unlock)
 *   Faith stage can only ADD access, never reduce it.
 *
 * ── Redis keys read ───────────────────────────────────────────────────────────
 *   progress:<email>   written by update-progress
 *   member:<email>     written by add-member (contains faithStage)
 */

const { cmd, pipeline } = require('./redis');

const TOTAL_LESSONS = 48;

const FAITH_STAGE_ACCESS = {
  just_starting: 1,
  feeling_stuck: 2,
  returning    : 1,
  growing      : 3,
};

const BADGE_THRESHOLDS = {
  foundation: 16,
  word      : 32,
  prayer    : 40,
  identity  : 48,
};

// ── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  let email;
  try   { ({ email } = JSON.parse(event.body || '{}')); }
  catch { return reply(400, { error: 'Invalid JSON body' }); }

  email = (email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply(400, { error: 'email required' });
  }

  // ── Fetch progress + member records in a single round-trip ───────────────
  let progressRaw, memberRaw;
  try {
    ([progressRaw, memberRaw] = await pipeline(
      ['GET', `progress:${email}`],
      ['GET', `member:${email}`],
    ));
  } catch (err) {
    console.error('[get-progress] Redis error:', err);
    return reply(500, { error: 'internal error' });
  }

  // ── Parse member record (source of faithStage) ───────────────────────────
  let member = {};
  try { if (memberRaw) member = JSON.parse(memberRaw); } catch {}
  const faithStage = member.faithStage || '';

  // ── Brand-new member — nothing recorded yet ──────────────────────────────
  if (!progressRaw) {
    return reply(200, {
      ...zeroState(),
      moduleAccess: FAITH_STAGE_ACCESS[faithStage] || 1,
      faithStage,
    });
  }

  // ── Parse stored progress ────────────────────────────────────────────────
  let stored = {};
  try { stored = JSON.parse(progressRaw); }
  catch {
    console.error('[get-progress] Corrupt progress record for', email);
    return reply(200, { ...zeroState(), moduleAccess: 1, faithStage });
  }

  // ── Derived fields ───────────────────────────────────────────────────────
  const lessonsCompleted = Math.min(Number(stored.lessonsCompleted) || 0, TOTAL_LESSONS);
  const streak           = resolveStreak(stored);
  const currentModule    = moduleFromLessons(lessonsCompleted);
  const nextLessonTitle  = stored.nextLessonTitle || defaultNextLesson(lessonsCompleted);
  const badgesEarned     = computeBadges(lessonsCompleted, stored.badgesEarned);

  // Effective module access = max(faith-stage day-1 grant, progress-based unlock)
  const faithGrant     = FAITH_STAGE_ACCESS[faithStage] || 1;
  const progressUnlock = lessonsCompleted >= 32 ? 3 : lessonsCompleted >= 16 ? 2 : 1;
  const moduleAccess   = Math.max(faithGrant, progressUnlock);

  // Opportunistically reset a stale streak (async, doesn't block the response)
  if (streak === 0 && Number(stored.streak) > 0) {
    resetStaleStreak(email, stored).catch(err =>
      console.warn('[get-progress] Stale streak reset failed:', err)
    );
  }

  return reply(200, {
    lessonsCompleted,
    streak,
    currentModule,
    nextLessonTitle,
    badgesEarned,
    moduleAccess,
    faithStage,
  });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function zeroState() {
  return {
    lessonsCompleted: 0,
    streak          : 0,
    currentModule   : 1,
    nextLessonTitle : 'Identity: Who Are You in Christ?',
    badgesEarned    : [],
  };
}

function resolveStreak(stored) {
  if (!stored.lastActivityDate) return 0;
  const diffDays = Math.round(
    (utcMidnight(new Date()) - utcMidnight(new Date(stored.lastActivityDate))) / 86_400_000
  );
  return diffDays <= 1 ? (Number(stored.streak) || 0) : 0;
}

function utcMidnight(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function moduleFromLessons(n) {
  if (n < 16) return 1;
  if (n < 32) return 2;
  return 3;
}

function defaultNextLesson(n) {
  if (n === 0) return 'Identity: Who Are You in Christ?';
  if (n < 16)  return 'Foundations of a Disciplined Prayer Life';
  if (n < 32)  return 'Rightly Dividing the Word of Truth';
  if (n < 48)  return 'Walking in the Spirit Daily';
  return '🎉 Course complete — well done!';
}

function computeBadges(lessonsCompleted, storedBadges) {
  const earned = new Set(Array.isArray(storedBadges) ? storedBadges : []);
  for (const [id, threshold] of Object.entries(BADGE_THRESHOLDS)) {
    if (lessonsCompleted >= threshold) earned.add(id);
  }
  return [...earned];
}

async function resetStaleStreak(email, stored) {
  const updated = JSON.stringify({ ...stored, streak: 0 });
  const ttl     = await cmd('TTL', `progress:${email}`);
  await cmd('SET', `progress:${email}`, updated, 'EX', ttl > 0 ? ttl : 60 * 60 * 24 * 730);
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body),
  };
}